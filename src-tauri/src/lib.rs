// DayCell 桌面壳 —— logo 悬浮球 + 常驻面板（v1.1.0）
//
// 交互模型：
//  - 收起：64pt logo 悬浮球贴主屏右缘、垂直居中、置顶（点击展开）
//  - 展开：按下悬浮球（pointerdown，首击即展开）/ 热键 / 托盘 → 414×896pt 面板贴右缘居中
//  - 收回：面板默认保持（鼠标移出不收回），收起走热键 / 托盘「展开 / 收起面板」
//  - 宽窗：托盘切换 820×900pt
//  - 热键 CmdOrCtrl+Shift+D：切换 悬浮球/面板
//  - 菜单栏托盘：展开/收起、宽窗模式、开机自启、退出
//
// 尺寸/位置常量均为「逻辑 pt」：与手机/网页 CSS 一致，保证面板视觉尺寸等于手机屏；
// monitor 返回物理像素，set_size/set_position 也收物理像素，apply_mode 里统一 ×scale。
// 前端在收起态渲染 logo 球（窗口 <90px 时 BallGate 切换），点击经 invoke('set_mode') 展开。

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const BALL_W: f64 = 64.0; // 悬浮球尺寸（正方形，逻辑 pt）
const PANEL_W: f64 = 414.0; // 面板宽度（≈iPhone Pro Max 逻辑宽）
const PANEL_H: f64 = 896.0; // 面板高度（≈iPhone Pro Max 逻辑高）
const WIDE_W: f64 = 820.0; // 宽窗模式宽度（逻辑 pt）
const WIDE_H: f64 = 900.0; // 宽窗模式高度（逻辑 pt）
const BALL_MARGIN: f64 = 12.0; // 悬浮球距右缘留白（逻辑 pt）

const M_BALL: u8 = 0;
const M_PANEL: u8 = 1;
const M_WIDE: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(M_BALL);

/// 悬浮球跨 Space 置顶：macOS 全屏应用（浏览器/视频/PPT）独占一个 Space，
/// 普通置顶窗口会被留在桌面 Space（这就是"全屏时看不到球"的原因）。
/// CanJoinAllSpaces | FullScreenAuxiliary 让球在所有 Space（含全屏应用之上）永远可见可点；
/// 面板/宽窗态恢复默认行为（普通窗口，保证可输入）。
#[cfg(target_os = "macos")]
fn set_float_behavior(win: &tauri::WebviewWindow, float: bool) {
    use objc2::{msg_send, MainThreadMarker};
    let _mtm = MainThreadMarker::new().expect("collectionBehavior 须在主线程设置");
    if let Ok(ptr) = win.ns_window() {
        let obj = ptr as *mut objc2::runtime::AnyObject;
        unsafe {
            // NSWindowCollectionBehaviorCanJoinAllSpaces=1<<8 | FullScreenAuxiliary=1<<9
            let behavior: u64 = if float { (1 << 8) | (1 << 9) } else { 0 };
            let _: () = msg_send![obj, setCollectionBehavior: behavior];
            eprintln!("[diag] float_behavior={} ptr={:?}", float, ptr);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn set_float_behavior(_win: &tauri::WebviewWindow, _float: bool) {}

/// 应用窗口模式（改尺寸 + 位置）。focus=true 时把窗口带到前台。
///
/// 尺寸/位置常量都是「逻辑 pt」（与手机/网页 CSS 一致，保证视觉尺寸等于手机屏）。
/// monitor.size()/position() 返回物理像素，统一用 scale_factor 换算后再传给
/// set_size/set_position（这两个 API 收物理像素）。
fn apply_mode(app: &AppHandle, mode: u8, focus: bool) {
    MODE.store(mode, Ordering::Relaxed);
    let Ok(Some(mon)) = app.primary_monitor() else {
        return;
    };
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let msize = mon.size(); // 物理
    let mpos = mon.position(); // 物理
    let scale = mon.scale_factor();
    let msize_l = msize.width as f64 / scale; // 逻辑宽
    let mheight_l = msize.height as f64 / scale; // 逻辑高
    let mright_l = mpos.x as f64 / scale + msize_l; // 逻辑右缘
    let mtop_l = mpos.y as f64 / scale; // 逻辑顶
    let (w_l, h_l, x_l, y_l) = match mode {
        M_BALL => {
            let s = BALL_W;
            (
                s,
                s,
                mright_l - s - BALL_MARGIN,
                mtop_l + (mheight_l - s) / 2.0,
            )
        }
        M_PANEL => (
            PANEL_W,
            PANEL_H,
            mright_l - PANEL_W,
            mtop_l + (mheight_l - PANEL_H) / 2.0,
        ),
        M_WIDE => (
            WIDE_W,
            WIDE_H,
            mright_l - WIDE_W,
            mtop_l + (mheight_l - WIDE_H) / 2.0,
        ),
        _ => return,
    };
    let w = (w_l * scale) as u32;
    let h = (h_l * scale) as u32;
    let x = (x_l * scale) as i32;
    let y = (y_l * scale) as i32;
    eprintln!(
        "[diag] apply_mode: mode={} w_phy={} h_phy={} x_phy={} y_phy={} (logic {}x{} scale={})",
        mode, w, h, x, y, w_l, h_l, scale
    );
    // 悬浮球必须置顶（随时可点、不被全屏窗口盖住）；面板/宽窗正常层级
    let _ = win.set_always_on_top(mode == M_BALL);
    // 球态跨 Space 置顶（全屏 App 下也可见可点），面板态恢复普通窗口
    set_float_behavior(&win, mode == M_BALL);
    // Tauri 对不可调整大小的窗口会忽略 set_size，动态伸缩前必须先解锁
    let _ = win.set_resizable(true);
    let _ = win.set_size(PhysicalSize::new(w, h));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_resizable(false);
    if focus {
        let _ = win.set_focus();
    }
}

/// 前端悬浮球点击 / 热键 / 托盘左键：切换 悬浮球 ↔ 面板
fn toggle(app: &AppHandle) {
    let m = MODE.load(Ordering::Relaxed);
    let next = if m == M_BALL { M_PANEL } else { M_BALL };
    apply_mode(app, next, true);
}

/// 前端 invoke 入口：'panel' | 'wide' | 'ball'
#[tauri::command]
fn set_mode(app: AppHandle, mode: String) {
    eprintln!("[diag] set_mode called: mode={}", mode);
    let m = match mode.as_str() {
        "panel" => M_PANEL,
        "wide" => M_WIDE,
        "ball" => M_BALL,
        _ => return,
    };
    apply_mode(&app, m, m != M_BALL);
}

/// 面板态默认保持（不自动收回）：鼠标移出面板不会收起，
/// 收起走：热键 / 托盘"展开 / 收起面板"。悬浮球态无轮询（点击才展开）。

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_i = MenuItemBuilder::with_id("toggle", "展开 / 收起面板").build(app)?;
    let wide_i = MenuItemBuilder::with_id("wide", "切换宽窗模式").build(app)?;
    let auto_i = CheckMenuItemBuilder::with_id("autostart", "开机自启").build(app)?;
    let quit_i = MenuItemBuilder::with_id("quit", "退出 DayCell").build(app)?;
    let menu = Menu::with_items(app, &[&toggle_i, &wide_i, &auto_i, &quit_i])?;

    // 初始化自启勾选态
    if let Ok(true) = app.autolaunch().is_enabled() {
        let _ = auto_i.set_checked(true);
    }

    // 菜单事件闭包直接持有菜单项引用（避免依赖 tray.menu() 的运行时查询）
    let auto_handle = auto_i.clone();

    let icon = app.default_window_icon().cloned().expect("窗口图标缺失");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "wide" => {
                let m = MODE.load(Ordering::Relaxed);
                let next = if m == M_WIDE { M_PANEL } else { M_WIDE };
                apply_mode(app, next, true);
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
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
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
        .invoke_handler(tauri::generate_handler![set_mode])
        .setup(|app| {
            let handle = app.handle().clone();
            // 启动即悬浮球贴右缘居中
            apply_mode(&handle, M_BALL, false);
            // 全局热键：悬浮球/面板 切换
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
