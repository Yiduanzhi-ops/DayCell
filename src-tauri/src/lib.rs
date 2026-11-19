// DayCell 桌面壳 —— 右缘悬浮球 + 手机尺寸面板（v1.3.0）
//
// 交互模型：
//  - 启动：右缘中部常驻一颗圆球（60pt，半透明），面板隐藏；不占 Dock/桌面
//  - 展开：单击球 → 414×896pt（手机同尺寸）面板贴右缘垂直居中展开；
//    球滑到面板左侧变成「收起」箭头
//  - 收起：再点球 / 点面板以外任何地方 / 按热键 → 面板隐藏，球回到右缘
//  - 热键 Cmd+Shift+D、托盘图标仍可展开/收起（保留原有路径）
//  - 宽窗：托盘菜单切换 820pt（给月视图这类密集页面）
//  - 托盘：展开/收起、宽窗模式、显示悬浮球、开机自启、退出
//
// 尺寸/位置常量均为「逻辑 pt」：与手机/网页 CSS 一致，保证面板视觉尺寸等于手机屏；
// monitor 返回物理像素，set_size/set_position 也收物理像素，apply_mode 里统一 ×scale。

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

/// 面板尺寸：固定 414×896 逻辑 pt = iPhone 14 Pro Max 的视口尺寸。
/// 用户要的是「点开就是手机上的 DayCell」，所以不按屏宽比例缩放；
/// 只有屏幕装不下 896 时才整体等比缩小（保持手机比例）。
const PANEL_W: f64 = 414.0;
const PANEL_H: f64 = 896.0;
const PANEL_MIN_MARGIN_V: f64 = 56.0; // 上下各留一点（顶部菜单栏 / 底部 Dock）

const WIDE_W: f64 = 820.0; // 宽窗模式宽度（逻辑 pt）
const WIDE_H_RATIO: f64 = 0.85; // 宽窗模式高度 = 所在屏幕逻辑高 × 85%

/// 悬浮球：窗口 80pt，球 60pt 居中（四周 10pt 留给投影，避免被窗口边界裁掉）
const BALL_W: f64 = 80.0;
const BALL_GAP: f64 = 20.0; // 收起态窗口距屏幕右缘（球在窗口内居中，再内缩 10）
const BALL_Y_RATIO: f64 = 0.40; // 收起态垂直位置（屏高比例；避开 Dock 与顶部菜单栏）
const BALL_PANEL_GAP: f64 = 10.0; // 展开态球与面板左缘的间距

const M_PANEL: u8 = 1;
const M_WIDE: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(M_PANEL);

/// 最近一次展开的时间戳（毫秒）。用于忽略「展开瞬间」的失焦抖动，
/// 避免面板刚弹出就被 Focused(false) 立刻收起（开-收-开 抖动的根因）。
static LAST_EXPAND_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 面板在指定屏幕上的逻辑尺寸（414×896，屏幕装不下时等比缩小）。
fn panel_size_for(mon: &tauri::Monitor) -> (f64, f64) {
    let scale = mon.scale_factor();
    let mh_l = mon.size().height as f64 / scale;
    let max_h = mh_l - PANEL_MIN_MARGIN_V;
    if max_h <= 0.0 {
        return (PANEL_W, PANEL_H);
    }
    let k = if PANEL_H > max_h { max_h / PANEL_H } else { 1.0 };
    (PANEL_W * k, PANEL_H * k)
}


/// 面板跨 Space 原地浮层：macOS 全屏应用独占一个 Space，普通窗口会
/// 被切回桌面（用户"展开回到桌面"的根因）。给窗口加上
/// CanJoinAllSpaces | FullScreenAuxiliary + NSStatusWindowLevel(25)：
///  1. 放行进入全屏 Space；
///  2. 层级提到状态栏同级，浮在全屏应用之上 → 任何界面点图标都**原地展开**，不切 Space。
/// 所有模式（面板/宽窗）统一生效；收起时窗口 hide 不影响。
#[cfg(target_os = "macos")]
fn set_float_behavior(win: &tauri::WebviewWindow) {
    use objc2::{msg_send, MainThreadMarker};
    // 只在主线程设置（setup / 托盘 / 热键回调都是主线程）。
    // 不 panic：万一非主线程调用，跳过本次设置，窗口仍可显示（只是不跨 Space）。
    if MainThreadMarker::new().is_none() {
        eprintln!("[diag] float_behavior skipped (not main thread)");
        return;
    }
    if let Ok(ptr) = win.ns_window() {
        let obj = ptr as *mut objc2::runtime::AnyObject;
        unsafe {
            // 关键：regular 应用会把窗口钉在它所属的 Space 上，collectionBehavior
            // 怎么设都不跨桌面；改成 accessory(1) 后窗口才真正跟随所有 Space
            // （实测切换桌面后 on_active=true / occl=8194，球正常显示）。
            let nsapp: *mut objc2::runtime::AnyObject =
                msg_send![objc2::class!(NSApplication), sharedApplication];
            let _: bool = msg_send![nsapp, setActivationPolicy: 1i64];
            // NSWindowCollectionBehavior:
            //   CanJoinAllSpaces = 1<<0（**关键**：切换桌面/Space 后窗口仍显示；
            //   之前误写成 1<<8，导致球只在当前桌面可见，切屏就消失）
            //   Stationary = 1<<4（不随空间移动）
            //   IgnoresCycle = 1<<6（不参与 Cmd+Tab / 窗口循环）
            //   FullScreenAuxiliary = 1<<8（可浮在全屏应用之上）
            // 球用 0x51（不含 FullScreenAuxiliary：辅助层会让窗口绑到某个 Space，
            // 实测切桌面后球会消失）；面板保留 0x111 以便浮在全屏应用之上。
            // 关键：Tauri 建出的窗口 styleMask 只有 FullSizeContentView|Miniaturizable(0x8004)，
            // 没有 Borderless，AppKit 不认 canJoinAllSpaces，切桌面后窗口就被挡在原 Space。
            // 补上 Borderless(0x10) 后跨 Space 才生效（0x8010）。
            // 注意：这里不要动 styleMask。setStyleMask 会让 AppKit 重排窗口 frame
            // （球会被挪回屏幕中间），而 builder 建出来的球窗口本来就是 0x800c，无需补位。
            // 只留 CanJoinAllSpaces：实测叠加 Stationary(1<<4) 会让窗口被钉在原 Space，
            // 切换桌面后球整个消失（这就是「球只在主桌面显示」的根因）。
            let behavior: u64 = if win.label() == "ball" {
                1 << 0 | 1 << 4 | 1 << 8
            } else {
                (1 << 0) | (1 << 8)
            };
            // NSWindowLevel 是 NSInteger（i64）！传 f64 会在 arm64 调用约定里走浮点寄存器，
            // 导致 setLevel 实际不生效（此前 winlist 显示窗口 layer=普通层，未浮在全屏之上）。
            let level: i64 = 25; // NSStatusWindowLevel（与菜单栏图标同级）
            let _: () = msg_send![obj, setCollectionBehavior: behavior];
            // 走一遍 Tauri 官方 API，确保 tao 内部状态与 AppKit 一致。
            let _ = win.set_visible_on_all_workspaces(true);
            // 关键：app 失去焦点（切到别的应用/桌面）时不要隐藏窗口，
            // 否则切屏后球整个消失（Tauri 默认窗口有 hidesOnDeactivate 行为）。
            let _: () = msg_send![obj, setHidesOnDeactivate: false];
            let _: () = msg_send![obj, setLevel: level];
            // 实验探针：BALL_PROBE_RED=1 时把球窗口刷成不透明纯红，用来区分
            // 「窗口本身跨不了 Space」还是「透明/WebView 渲染问题」。
            if std::env::var("BALL_PROBE_REMOVE_WV").is_ok() && win.label() == "ball" {
                // 实验探针：把 webview 从窗口里摘掉，只看窗口本体能否跨 Space。
                let cv: *mut objc2::runtime::AnyObject = msg_send![obj, contentView];
                let subs: *mut objc2::runtime::AnyObject = msg_send![cv, subviews];
                let n: usize = msg_send![subs, count];
                for i in 0..n {
                    let v: *mut objc2::runtime::AnyObject =
                        msg_send![subs, objectAtIndex: i];
                    let _: () = msg_send![v, removeFromSuperview];
                }
                eprintln!("[diag] ball probe removed {} webview subviews", n);
            }
            if std::env::var("BALL_PROBE_RED").is_ok() && win.label() == "ball" {
                let red: *mut objc2::runtime::AnyObject =
                    msg_send![objc2::class!(NSColor), redColor];
                let _: () = msg_send![obj, setBackgroundColor: red];
                let _: () = msg_send![obj, setOpaque: true];
                eprintln!("[diag] ball probe red applied");
            }
            // 读取验证：确认设置真正生效（level 应为 25，behavior 应为 0x300）
            let lv: i64 = msg_send![obj, level];
            let cb: u64 = msg_send![obj, collectionBehavior];
            eprintln!(
                "[diag] float_behavior=true level={} behavior={:#x} ptr={:?}",
                lv, cb, ptr
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_float_behavior(_win: &tauri::WebviewWindow) {}

/// 强制显示：Tauri 的 show() 在 macOS 走 makeKeyAndOrderFront，
/// 而 FullScreenAuxiliary 辅助窗口不能成为 key window → 全屏 Space 下 show() 无效、
/// 面板不显示（桌面 Space 下窗口可 key 所以正常——这正是"桌面行、全屏不行"的根因）。
/// orderFrontRegardless 无视 key 状态直接把窗口放到前台，对辅助窗口有效。
#[cfg(target_os = "macos")]
fn order_front_anyway(win: &tauri::WebviewWindow) {
    use objc2::msg_send;
    if let Ok(ptr) = win.ns_window() {
        let obj = ptr as *mut objc2::runtime::AnyObject;
        unsafe {
            let _: () = msg_send![obj, orderFrontRegardless];
        }
        eprintln!("[diag] orderFrontRegardless");
    }
}

#[cfg(not(target_os = "macos"))]
fn order_front_anyway(_win: &tauri::WebviewWindow) {}

/// 面板/宽窗模式（改尺寸 + 位置 + 显示）。focus=true 时把窗口带到前台。
///
/// 尺寸/位置常量都是「逻辑 pt」（与手机/网页 CSS 一致，保证视觉尺寸等于手机屏）。
/// monitor.size()/position() 返回物理像素，统一用 scale_factor 换算后再传给
/// set_size/set_position（这两个 API 收物理像素）。
fn apply_mode(app: &AppHandle, mode: u8, focus: bool) {
    MODE.store(mode, Ordering::Relaxed);
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    // 显示器选择：主屏优先（球常驻主屏右缘，面板必须和球在同一块屏上；
    // 之前按「鼠标所在屏」选，双屏下 monitor_from_point 会选到另一块屏，
    // 面板被摆到屏幕外/尺寸被缩放）。拿不到主屏再退回鼠标所在屏。
    let mon = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.cursor_position()
                .ok()
                .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        });
    let Some(mon) = mon else {
        return;
    };
    let msize = mon.size(); // 物理
    let mpos = mon.position(); // 物理
    let scale = mon.scale_factor();
    let msize_l = msize.width as f64 / scale; // 逻辑宽
    let mheight_l = msize.height as f64 / scale; // 逻辑高
    let mright_l = mpos.x as f64 / scale + msize_l; // 逻辑右缘
    let mtop_l = mpos.y as f64 / scale; // 逻辑顶
    // 面板尺寸：固定手机尺寸 414×896（装不下时等比缩小）；宽窗仍按屏高比例
    let (w_l, h_l) = match mode {
        M_PANEL => panel_size_for(&mon),
        M_WIDE => (WIDE_W, mheight_l * WIDE_H_RATIO),
        _ => return,
    };
    let x_l = mright_l - w_l;
    let y_l = mtop_l + (mheight_l - h_l) / 2.0;
    let w = (w_l * scale) as u32;
    let h = (h_l * scale) as u32;
    let x = (x_l * scale) as i32;
    let y = (y_l * scale) as i32;
    eprintln!(
        "[diag] apply_mode: mode={} w_phy={} h_phy={} x_phy={} y_phy={} (logic {}x{} scale={})",
        mode, w, h, x, y, w_l, h_l, scale
    );
    // Tauri 对不可调整大小的窗口会忽略 set_size，动态伸缩前必须先解锁
    let _ = win.set_resizable(true);
    let _ = win.set_size(PhysicalSize::new(w, h));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_resizable(false);
    // 关键：Tauri 的 hide/show 可能重置窗口 collectionBehavior（跨 Space 属性），
    // 每次展开前重新强制「所有 Space 可见 + 辅助浮层 + 状态栏层级」，
    // 否则全屏 Space 下面板会落到桌面 Space（用户看不到面板——本轮根因）。
    let _ = win.set_visible_on_all_workspaces(true);
    set_float_behavior(&win);
    let _ = win.show();
    // 全屏 Space 下 show() 可能无效，用 orderFrontRegardless 强制浮到前台
    order_front_anyway(&win);
    if focus {
        // accessory 策略下 app 默认不在前台，窗口拿不到 key（面板会立刻被判失焦收起）。
        // 展开面板时主动把 app 带到前台。
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{class, msg_send};
            let nsapp: *mut objc2::runtime::AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![nsapp, activateIgnoringOtherApps: true];
        }
        let _ = win.set_focus();
    }
}

/// 摆放悬浮球。expanded=true 时贴到面板左侧（变成收起把手），false 时回右缘常驻。
// 切换 Space 后重建球窗口：本机上 tao 窗口的 canJoinAllSpaces 不生效
// （窗口只在创建它的那个 Space 里显示），因此每次切换都销毁重建，
// 让新窗口落在切换后的 Space 上。
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// 面板的失焦收起绑定。窗口重建后这条绑定会随旧窗口一起消失，必须重新挂一次。
fn bind_panel_blur(h: &AppHandle) {
    if let Some(win) = h.get_webview_window("main") {
        let hh = h.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Focused(false) = event {
                let since = now_ms().saturating_sub(LAST_EXPAND_MS.load(Ordering::Relaxed));
                if since > 350 {
                    let visible = hh
                        .get_webview_window("main")
                        .map(|w| w.is_visible().unwrap_or(false))
                        .unwrap_or(false);
                    if visible {
                        collapse(&hh);
                    }
                }
            }
        });
    }
}

fn create_panel(app: &AppHandle) -> bool {
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .inner_size(PANEL_W, PANEL_H)
    .decorations(false)
    .resizable(false)
    .shadow(true)
    .visible(false)
    .accept_first_mouse(true)
    // 和球同理：必须在首次上屏前带上这个属性，否则面板会钉在创建时所在的桌面，
    // 用户切到别的桌面点球就什么也看不到。
    .visible_on_all_workspaces(true)
    .build();
    match built {
        Ok(_) => {
            bind_panel_blur(app);
            true
        }
        Err(e) => {
            eprintln!("[panel] create failed: {e}");
            false
        }
    }
}

fn rebuild_panel(app: &AppHandle) {
    let a = app.clone();
    let a_in = a.clone();
    let _ = a.run_on_main_thread(move || {
        if let Some(w) = a_in.get_webview_window("main") {
            let _ = w.destroy();
        }
    });
    // destroy 是异步的：窗口还没从注册表里消失时就建同名窗口会失败
    // （日志里的 `a webview with label main already exists`）。
    for _ in 0..30 {
        if app.get_webview_window("main").is_none() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    for _ in 0..4 {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let b = app.clone();
        let b_in = b.clone();
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done_in = done.clone();
        let _ = b.run_on_main_thread(move || {
            done_in.store(create_panel(&b_in), std::sync::atomic::Ordering::Relaxed);
        });
        std::thread::sleep(std::time::Duration::from_millis(60));
        if done.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
    }
}

fn create_ball(app: &AppHandle) -> bool {
    let built = tauri::WebviewWindowBuilder::new(
        app,
        "ball",
        tauri::WebviewUrl::App("ball.html".into()),
    )
    .inner_size(80.0, 80.0)
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .focused(false)
    .accept_first_mouse(true)
    // 关键：必须在窗口「首次上屏之前」就带上这个属性。上屏后再补设，AppKit 不会把
    // 已归属到某个 Space 的窗口迁移出去，球就会一直钉在创建它时所在的那个桌面上。
    .visible_on_all_workspaces(true)
    .build();
    match built {
        Ok(w) => {
            // 透明必须真的透：不显式把窗口底色写成全透明时，重建出来的球窗外围
            // 会露出一整块浅灰方块（80×80 的窗口底色）。
            let _ = w.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
            bind_ball_events(app);
            apply_ball(app, false);
            true
        }
        Err(e) => {
            eprintln!("[ball] create failed: {e}");
            false
        }
    }
}

fn rebuild_ball(app: &AppHandle) {
    // destroy 必须在主线程执行，且要等它把窗口从 WebviewWindows 里注销，
    // 所以放到后台线程：主线程销毁 → 等一拍 → 主线程重建。
    let a = app.clone();
    let a_in = a.clone();
    let _ = a.run_on_main_thread(move || {
        if let Some(w) = a_in.get_webview_window("ball") {
            let _ = w.destroy();
        }
    });
    // 等一拍让旧窗口从 WebviewWindows 里注销（destroy 是异步的），再重建。
    // 偶尔仍会撞上 "already exists"，重试几次兜住。
    for _ in 0..4 {
        std::thread::sleep(std::time::Duration::from_millis(120));
        let b = app.clone();
        let b_in = b.clone();
        let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let done_in = done.clone();
        let _ = b.run_on_main_thread(move || {
            done_in.store(create_ball(&b_in), std::sync::atomic::Ordering::Relaxed);
        });
        std::thread::sleep(std::time::Duration::from_millis(60));
        if done.load(std::sync::atomic::Ordering::Relaxed) {
            // 新建窗口的第一次 set_position 常被 AppKit 丢掉（球会停在屏幕中间），
            // 再摆一次就稳定了——展开/收起时的那次摆位一直是生效的。
            std::thread::sleep(std::time::Duration::from_millis(120));
            let c = app.clone();
            let c_in = c.clone();
            let _ = c.run_on_main_thread(move || apply_ball(&c_in, false));
            return;
        }
    }
}

#[cfg(target_os = "macos")]
extern "C" fn space_changed(
    _this: *mut objc2::runtime::AnyObject,
    _sel: objc2::runtime::Sel,
    _note: *mut objc2::runtime::AnyObject,
) {
    eprintln!("[diag] active space changed");
    if let Some(h) = APP_HANDLE.get() {
        let h = h.clone();
        std::thread::spawn(move || {
            rebuild_panel(&h);
            rebuild_ball(&h);
        });
    }
}

/// 球的垂直位置（逻辑点，相对主屏左上角）。0 表示还没记录过，回落到默认比例。
static BALL_Y_L: AtomicU64 = AtomicU64::new(0);
/// 用户正在拖动球（只有这段时间才记录位置、才纠正横向偏移）
static BALL_DRAGGING: AtomicBool = AtomicBool::new(false);
/// 球当前是否处于展开态（决定"贴边"的 x 是哪一条）
static BALL_EXPANDED: AtomicBool = AtomicBool::new(false);
/// 上次把位置写盘的时间戳（毫秒），拖动时做节流
static BALL_SAVED_AT: AtomicU64 = AtomicU64::new(0);

fn ball_cfg_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("ball-y.txt"))
}

fn load_ball_y(app: &AppHandle) {
    if let Some(p) = ball_cfg_path(app) {
        if let Ok(s) = std::fs::read_to_string(p) {
            if let Ok(v) = s.trim().parse::<f64>() {
                BALL_Y_L.store(v.to_bits(), Ordering::Relaxed);
            }
        }
    }
}

fn persist_ball_y(app: &AppHandle) {
    // 直接落盘拖动期间 Moved 记下的 y（比读窗口 frame 更可靠）
    let bits = BALL_Y_L.load(Ordering::Relaxed);
    if bits == 0 {
        return;
    }
    eprintln!("[diag] persist ball y = {:.1}", f64::from_bits(bits));
    if let Some(p) = ball_cfg_path(app) {
        if let Some(dir) = p.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(p, format!("{:.1}", f64::from_bits(bits)));
    }
}

/// 球的几何：返回 (x_l, y_l, y_min_l, y_max_l, scale)。
/// 收起态贴右缘；展开态挪到面板左侧。
fn ball_geom(app: &AppHandle, expanded: bool) -> Option<(f64, f64, f64, f64, f64)> {
    let mon = app.primary_monitor().ok().flatten().or_else(|| {
        app.cursor_position()
            .ok()
            .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
    })?;
    let scale = mon.scale_factor();
    let msize = mon.size();
    let mpos = mon.position();
    let mw_l = msize.width as f64 / scale;
    let mh_l = msize.height as f64 / scale;
    let left_l = mpos.x as f64 / scale;
    let top_l = mpos.y as f64 / scale;

    let x_l = if expanded {
        let (pw_l, _) = panel_size_for(&mon);
        left_l + mw_l - pw_l - BALL_W - BALL_PANEL_GAP
    } else {
        left_l + mw_l - BALL_W - BALL_GAP
    };
    // 展开时面板从球顶往下铺，y 必须给面板留出整屏高度，否则底部的"复盘/回顾"会被屏幕裁掉
    let y_min = if expanded {
        top_l + PANEL_MIN_MARGIN_V
    } else {
        top_l
    };
    let y_max = if expanded {
        top_l + (mh_l - PANEL_H - PANEL_MIN_MARGIN_V).max(y_min - top_l)
    } else {
        top_l + mh_l - BALL_W
    };
    let default_y = top_l + (mh_l - BALL_W) * BALL_Y_RATIO;
    let bits = BALL_Y_L.load(Ordering::Relaxed);
    let y_l = if bits == 0 {
        default_y
    } else {
        f64::from_bits(bits).clamp(y_min, y_max)
    };
    Some((x_l, y_l, y_min, y_max, scale))
}

/// 球窗口的移动约束：只允许上下。每次被拖动时把 x 拉回右缘，并记下 y。
fn bind_ball_events(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("ball") {
        let h = app.clone();
        let w = win.clone();
        win.on_window_event(move |event| {
            if let WindowEvent::Moved(p) = event {
                let expanded = BALL_EXPANDED.load(Ordering::Relaxed);
                let Some((x_l, _y, y_min, y_max, scale)) = ball_geom(&h, expanded) else {
                    return;
                };
                let edge = (x_l * scale) as i32;
                let y_top = (y_min * scale) as i32;
                let y_bot = (y_max * scale) as i32;
                let clamped = p.y.clamp(y_top, y_bot);
                // 只允许上下：横向被带偏就拉回贴边位
                if (p.x - edge).abs() > 2 || clamped != p.y {
                    let _ = w.set_position(tauri::PhysicalPosition::new(edge, clamped));
                }
                BALL_Y_L.store(((clamped as f64) / scale).to_bits(), Ordering::Relaxed);
                if expanded {
                    return;
                }
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if now.saturating_sub(BALL_SAVED_AT.load(Ordering::Relaxed)) > 400 {
                    BALL_SAVED_AT.store(now, Ordering::Relaxed);
                    persist_ball_y(&h);
                }
            }
        });
    }
}

#[tauri::command]
fn ball_drag(app: AppHandle) {
    BALL_DRAGGING.store(true, Ordering::Relaxed);
    let a = app.clone();
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let done_in = done.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = a.get_webview_window("ball") {
            // AppKit 原生拖动：需要主线程，会阻塞到用户松手
            let _ = w.start_dragging();
        }
        done_in.store(true, Ordering::Relaxed);
    });
    for _ in 0..300 {
        if done.load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    BALL_DRAGGING.store(false, Ordering::Relaxed);
    // 松手后收回到右缘（万一拖动期间 x 被带偏），并落盘
    if let (Some(w), Some((x_l, _, _, _, scale))) =
        (app.get_webview_window("ball"), ball_geom(&app, false))
    {
        if let Ok(cur) = w.outer_position() {
            let _ = w.set_position(tauri::PhysicalPosition::new((x_l * scale) as i32, cur.y));
        }
    }
    persist_ball_y(&app);
}

fn apply_ball(app: &AppHandle, expanded: bool) {
    let Some(win) = app.get_webview_window("ball") else {
        return;
    };
    // 球固定在主屏右缘（用户视线常驻的位置）；拿不到主屏时退回鼠标所在屏
    let mon = app
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| {
            app.cursor_position()
                .ok()
                .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        });
    let Some(mon) = mon else {
        return;
    };
    let scale = mon.scale_factor();
    let msize = mon.size();
    let mpos = mon.position();
    let mw_l = msize.width as f64 / scale;
    let mh_l = msize.height as f64 / scale;
    let left_l = mpos.x as f64 / scale;
    let top_l = mpos.y as f64 / scale;

    let x_l = if expanded {
        let (pw_l, _) = panel_size_for(&mon);
        left_l + mw_l - pw_l - BALL_W - BALL_PANEL_GAP
    } else {
        left_l + mw_l - BALL_W - BALL_GAP
    };
    let _ = (top_l, mh_l);
    let y_l = match ball_geom(app, expanded) {
        Some((_, y, _, _, _)) => y,
        None => top_l + (mh_l - BALL_W) * BALL_Y_RATIO,
    };
    let x = (x_l * scale) as i32;
    let y = (y_l * scale) as i32;

    eprintln!(
        "[diag] apply_ball: expanded={} x_phy={} y_phy={} (logic {},{} scale={})",
        expanded, x, y, x_l, y_l, scale
    );

    let _ = win.set_visible_on_all_workspaces(true);
    set_float_behavior(&win);
    // 顺序很关键：macOS 上对隐藏窗口 set_position 会被忽略（窗口停在系统给的默认位置），
    // 必须先 show 再摆位置。
    let _ = win.show();
    order_front_anyway(&win);
    let _ = win.set_position(tauri::LogicalPosition::new(x_l, y_l));
    eprintln!(
        "[diag] ball after show: visible={:?} pos={:?} size={:?}",
        win.is_visible(),
        win.outer_position(),
        win.inner_size()
    );
    BALL_EXPANDED.store(expanded, Ordering::Relaxed);
    let _ = win.eval(if expanded {
        "document.body.classList.add('expanded')"
    } else {
        "document.body.classList.remove('expanded')"
    });
    // 诊断：确认重建出来的 webview 到底加载到了什么
    let _ = win.eval("console.log('[ball-page] ' + document.readyState + ' ' + location.href + ' body=' + (document.body ? document.body.innerHTML.length : -1))");
}

/// 展开面板：按上次模式铺开，同时把球挪到面板左侧
fn expand(app: &AppHandle) {
    let m = MODE.load(Ordering::Relaxed);
    // focus=true 是必需的：macOS 上 FullScreenAuxiliary 辅助窗口只有 app 活跃时才显示，
    // 否则全屏应用下点球弹不出来（v1.2 已验证过的坑）。
    apply_mode(app, if m == M_WIDE { M_WIDE } else { M_PANEL }, true);
    LAST_EXPAND_MS.store(now_ms(), Ordering::Relaxed);
    apply_ball(app, true);
}

/// 收起面板：隐藏窗口，球回右缘
fn collapse(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    apply_ball(app, false);
}

/// 展开 / 收起：面板可见则收，隐藏则展
fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        eprintln!("[diag] toggle: visible={}", visible);
        if visible {
            collapse(app);
        } else {
            expand(app);
        }
    }
}

/// 悬浮球被点击：面板开着就收，关着就展
#[tauri::command]
fn ball_click(app: AppHandle) {
    eprintln!("[diag] ball_click");
    toggle(&app);
}

/// 前端 invoke 入口：'panel' | 'wide'（保留给页面内可能的呼出入口）
#[tauri::command]
fn set_mode(app: AppHandle, mode: String) {
    eprintln!("[diag] set_mode called: mode={}", mode);
    let m = match mode.as_str() {
        "panel" => M_PANEL,
        "wide" => M_WIDE,
        _ => return,
    };
    apply_mode(&app, m, true);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_i = MenuItemBuilder::with_id("toggle", "展开 / 收起面板").build(app)?;
    let wide_i = MenuItemBuilder::with_id("wide", "切换宽窗模式").build(app)?;
    let ball_i = CheckMenuItemBuilder::with_id("ball", "显示悬浮球").checked(true).build(app)?;
    let auto_i = CheckMenuItemBuilder::with_id("autostart", "开机自启").build(app)?;
    let quit_i = MenuItemBuilder::with_id("quit", "退出 DayCell").build(app)?;
    let menu = Menu::with_items(app, &[&toggle_i, &wide_i, &ball_i, &auto_i, &quit_i])?;

    // 初始化自启勾选态
    if let Ok(true) = app.autolaunch().is_enabled() {
        let _ = auto_i.set_checked(true);
    }

    // 菜单事件闭包直接持有菜单项引用（避免依赖 tray.menu() 的运行时查询）
    let auto_handle = auto_i.clone();
    let ball_handle = ball_i.clone();

    let icon = app.default_window_icon().cloned().expect("窗口图标缺失");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        // macOS 关键行为（Tauri 2）：show_menu_on_left_click(true) 时左键单击
        // 只 popUpMenu、不派发 TrayIconEvent::Click → 面板永远不展开（"点了没反应"）。
        // 必须设 false：左键单击直接派发 Click → toggle 展开面板；右键仍弹菜单。
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "wide" => {
                let m = MODE.load(Ordering::Relaxed);
                let next = if m == M_WIDE { M_PANEL } else { M_WIDE };
                apply_mode(app, next, true);
                LAST_EXPAND_MS.store(now_ms(), Ordering::Relaxed);
                // 宽窗时球也要贴到宽窗左侧，否则会落在面板里面
                apply_ball(app, true);
            }
            "ball" => {
                if let Some(win) = app.get_webview_window("ball") {
                    let vis = win.is_visible().unwrap_or(false);
                    if vis {
                        let _ = win.hide();
                        let _ = ball_handle.set_checked(false);
                    } else {
                        let main_vis = app
                            .get_webview_window("main")
                            .map(|w| w.is_visible().unwrap_or(false))
                            .unwrap_or(false);
                        apply_ball(app, main_vis);
                        let _ = ball_handle.set_checked(true);
                    }
                }
            }
            "autostart" => {
                let cur = app.autolaunch().is_enabled().unwrap_or(false);
                let _ = if cur {
                    app.autolaunch().disable()
                } else {
                    app.autolaunch().enable()
                };
                let _ = auto_handle.set_checked(!cur);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 诊断：全屏 Space 下菜单栏滑出态的状态栏点击可能被系统吞掉（事件到不了 app），
            // 打印每个事件类型，用于区分「事件没到」vs「事件到了但显示失败」。
            eprintln!("[diag] tray event: {:?}", event);
            // 匹配 Left+Down：mouseDown 必定派发（mouseUp 在全屏滑出菜单栏场景可能丢失）。
            // 单击 = 一次 Down → toggle 一次。
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Down,
                ..
            } = event
            {
                eprintln!("[diag] tray Left Down -> toggle");
                let app = tray.app_handle();
                toggle(app);
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_mode, ball_click, ball_drag])
        .setup(|app| {
            let handle = app.handle().clone();
            // 面板窗口：跨 Space 浮层，启动时隐藏
            if let Some(win) = app.get_webview_window("main") {
                set_float_behavior(&win);
                let _ = win.hide();
            }
            load_ball_y(&handle);
            // 悬浮球窗口：同样跨 Space 置顶，启动即显示在右缘
            apply_ball(&handle, false);
            // 监听系统 Space 切换通知：切完立刻重建球窗口（见 rebuild_ball 注释）
            #[cfg(target_os = "macos")]
            {
                APP_HANDLE.set(handle.clone()).ok();
                unsafe {
                    use objc2::runtime::{AnyObject, ClassBuilder, Sel};
                    use objc2::{class, msg_send, sel};
                    let mut decl = ClassBuilder::new(c"DayCellSpaceObserver", class!(NSObject))
                        .expect("observer class");
                    decl.add_method(
                        sel!(spaceChanged:),
                        space_changed
                            as extern "C" fn(*mut AnyObject, Sel, *mut AnyObject),
                    );
                    let cls = decl.register();
                    let observer: *mut AnyObject = msg_send![cls, new];
                    let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
                    let nc: *mut AnyObject = msg_send![ws, notificationCenter];
                    let name: *mut AnyObject = msg_send![
                        class!(NSString),
                        stringWithUTF8String: c"NSWorkspaceActiveSpaceDidChangeNotification".as_ptr()
                    ];
                    let _: () = msg_send![
                        nc,
                        addObserver: observer,
                        selector: sel!(spaceChanged:),
                        name: name,
                        object: std::ptr::null::<AnyObject>()
                    ];
                    eprintln!("[diag] space observer installed");
                }
                // 启动后重建一次：配置里声明的球窗口和 builder 建的窗口在 AppKit 里
                // 行为不一致（前者切桌面后不可见），统一走 builder 路径。
                let h = handle.clone();
                std::thread::spawn(move || {
                    // 冷启动时 app 还没归属任何 Space，此时建出来的窗口会被塞进主桌面，
                    // 用户正在看的其他桌面上就看不见。先激活让 app 归属当前 Space，
                    // 再重建球窗口，新窗口才会在眼前的这个桌面上屏。
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    {
                        let hh = h.clone();
                        let _ = hh.run_on_main_thread(move || unsafe {
                            use objc2::{class, msg_send};
                            let nsapp: *mut objc2::runtime::AnyObject =
                                msg_send![class!(NSApplication), sharedApplication];
                            let _: () = msg_send![nsapp, activateIgnoringOtherApps: true];
                        });
                    }
                    std::thread::sleep(std::time::Duration::from_millis(250));
                    // 配置里声明的两个窗口都在「app 还没归属 Space」时创建，会钉在主桌面，
                    // 所以启动时统一重建一次，之后每次切 Space 也重建。
                    rebuild_panel(&h);
                    rebuild_ball(&h);
                });
            }
            // 全局热键：展开/收起面板
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+D", |app, _shortcut, ev| {
                if ev.state() == ShortcutState::Pressed {
                    toggle(app);
                }
            })?;
            // 菜单栏托盘
            build_tray(&handle)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("DayCell 壳启动失败")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // 窗口常驻，不因关闭请求退出（托盘退出走 app.exit）
            }
        });
}
