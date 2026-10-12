// DayCell 桌面壳 —— 菜单栏呼出式常驻面板（v1.2.0）
//
// 交互模型：
//  - 启动：窗口隐藏，只在菜单栏（托盘）保留 DayCell 图标，不占 Dock/桌面
//  - 展开：任何界面（含全屏应用）下，鼠标滑到屏幕顶部菜单栏 → 点 DayCell 图标 /
//    热键 Cmd+Shift+D → 414×896pt 面板贴主屏右缘垂直居中展开（全屏时自动切回面板空间）
//  - 收起：再点图标 / 热键 → 面板隐藏
//  - 宽窗：托盘菜单切换 820×900pt
//  - 托盘：展开/收起、宽窗模式、开机自启、退出
//
// 尺寸/位置常量均为「逻辑 pt」：与手机/网页 CSS 一致，保证面板视觉尺寸等于手机屏；
// monitor 返回物理像素，set_size/set_position 也收物理像素，apply_mode 里统一 ×scale。

use std::sync::atomic::{AtomicU8, Ordering};

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const PANEL_W_RATIO: f64 = 0.25; // 面板宽度 = 所在屏幕逻辑宽 × 25%（按屏比例自适应，比固定 414 更窄）
const PANEL_H_RATIO: f64 = 0.80; // 面板高度 = 所在屏幕逻辑高 × 80%（按屏比例自适应）
const WIDE_W: f64 = 820.0; // 宽窗模式宽度（逻辑 pt）
const WIDE_H_RATIO: f64 = 0.85; // 宽窗模式高度 = 所在屏幕逻辑高 × 85%

const M_PANEL: u8 = 1;
const M_WIDE: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(M_PANEL);

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
            // NSWindowCollectionBehaviorCanJoinAllSpaces=1<<8 | FullScreenAuxiliary=1<<9
            let behavior: u64 = (1 << 8) | (1 << 9);
            // NSWindowLevel 是 NSInteger（i64）！传 f64 会在 arm64 调用约定里走浮点寄存器，
            // 导致 setLevel 实际不生效（此前 winlist 显示窗口 layer=普通层，未浮在全屏之上）。
            let level: i64 = 25; // NSStatusWindowLevel（与菜单栏图标同级）
            let _: () = msg_send![obj, setCollectionBehavior: behavior];
            let _: () = msg_send![obj, setLevel: level];
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
    // 显示器选择：优先「鼠标当前所在显示器」——托盘点击/热键时鼠标就在用户当前屏，
    // 双屏下确保面板展开在用户正看着的那块屏上；拿不到再退回主显示器。
    let mon = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
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
    // 面板/宽窗尺寸：按所在屏幕逻辑尺寸 × 比例自适应（不固定像素，换屏自动适配）
    let (w_l, h_l) = match mode {
        M_PANEL => (msize_l * PANEL_W_RATIO, mheight_l * PANEL_H_RATIO),
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
        let _ = win.set_focus();
    }
}

/// 展开 / 收起：窗口可见则隐藏，隐藏则按上次模式在右缘展开
fn toggle(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        eprintln!("[diag] toggle: visible={}", visible);
        if visible {
            let _ = win.hide();
        } else {
            let m = MODE.load(Ordering::Relaxed);
            // 展开时 focus=true：
            //  macOS 要求 FullScreenAuxiliary 窗口在全屏 Space 显示的前提是 app 活跃
            //  （不活跃则辅助窗口不显示——此前 focus=false 全屏不显示的根因）。
            //  现在 level=25 + CanJoinAllSpaces|FullScreenAuxiliary 已正确生效，
            //  激活 app 时辅助窗口显示在所有 Space（含全屏），且不再切走。
            apply_mode(app, if m == M_WIDE { M_WIDE } else { M_PANEL }, true);
        }
    }
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
        .invoke_handler(tauri::generate_handler![set_mode])
        .setup(|app| {
            let handle = app.handle().clone();
            // 启动即设置跨 Space 浮层（主线程 setup，一次性），窗口隐藏只留菜单栏图标
            if let Some(win) = app.get_webview_window("main") {
                set_float_behavior(&win);
                let _ = win.hide();
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
