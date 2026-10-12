// DayCell 桌面壳 —— 侧边常驻（Dock 手感）
//
// 交互模型：
//  - 收起：一条 10px 宽的细竖条贴在主屏右缘
//  - 展开：鼠标划过屏幕右缘 8px 触发区 → 细条滑开成 360px 面板
//  - 收回：鼠标移出面板矩形 → 自动收回细条（可"锁定"停用）
//  - 热键 CmdOrCtrl+Shift+D：切换 展开/收起
//  - 菜单栏托盘：显示/隐藏、锁定、宽窗模式、开机自启、退出
//
// 鼠标坐标用轮询（40ms）+ CGEvent 读取，不需要辅助功能授权。

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Duration;

use tauri::menu::{CheckMenuItemBuilder, Menu, MenuItemBuilder};
use tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const BAR_W: f64 = 10.0; // 收起细条宽度
const PANEL_W: f64 = 360.0; // 展开面板宽度
const WIDE_W: f64 = 820.0; // 宽窗模式宽度
const EDGE: f64 = 8.0; // 右缘触发区（划过即展开）
const POLL_MS: u64 = 40; // 轮询间隔

const M_COLLAPSED: u8 = 0;
const M_EXPANDED: u8 = 1;
const M_WIDE: u8 = 2;

static MODE: AtomicU8 = AtomicU8::new(M_COLLAPSED);
static PINNED: AtomicBool = AtomicBool::new(false);

/// 全局鼠标位置（CoreGraphics 坐标：左下原点、y 向上）
#[cfg(target_os = "macos")]
fn mouse_pos() -> (f64, f64) {
    let p = objc2_app_kit::NSEvent::mouseLocation();
    (p.x, p.y)
}

#[cfg(not(target_os = "macos"))]
fn mouse_pos() -> (f64, f64) {
    (0.0, 0.0)
}

/// 应用窗口模式（改尺寸 + 位置）。focus=true 时把窗口带到前台。
fn apply_mode(app: &AppHandle, mode: u8, focus: bool) {
    MODE.store(mode, Ordering::Relaxed);
    let Ok(Some(mon)) = app.primary_monitor() else {
        return;
    };
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let msize = mon.size();
    let mpos = mon.position();
    let right = mpos.x + msize.width as i32;
    let (w, x) = match mode {
        M_COLLAPSED => (BAR_W as u32, right - BAR_W as i32),
        M_EXPANDED => (PANEL_W as u32, right - PANEL_W as i32),
        M_WIDE => (WIDE_W as u32, right - WIDE_W as i32),
        _ => return,
    };
    // Tauri 对不可调整大小的窗口会忽略 set_size，动态伸缩前必须先解锁
    let _ = win.set_resizable(true);
    let _ = win.set_size(PhysicalSize::new(w, msize.height));
    let _ = win.set_position(PhysicalPosition::new(x, mpos.y));
    let _ = win.set_resizable(false);
    if focus {
        let _ = win.set_focus();
    }
}

fn toggle(app: &AppHandle) {
    let m = MODE.load(Ordering::Relaxed);
    let next = if m == M_COLLAPSED { M_EXPANDED } else { M_COLLAPSED };
    apply_mode(app, next, true);
}

/// 边缘监听轮询：划过右缘展开，移出面板收回
fn edge_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        let mode = MODE.load(Ordering::Relaxed);
        let pinned = PINNED.load(Ordering::Relaxed);
        if !pinned {
            let (cx_pt, cy_cg_pt) = mouse_pos();
            if let Ok(Some(mon)) = app.primary_monitor() {
                let msize = mon.size();
                let mpos = mon.position();
                let scale = mon.scale_factor();
                // 鼠标坐标是 pt，monitor 尺寸/位置是物理像素，统一换算成像素
                let cx = cx_pt * scale;
                let cy_cg = cy_cg_pt * scale;
                let right = (mpos.x + msize.width as i32) as f64;
                let top = mpos.y as f64;
                let bottom = (mpos.y + msize.height as i32) as f64;
                let cy = bottom - cy_cg; // 转左上原点
                match mode {
                    M_COLLAPSED => {
                        // 鼠标滑入右缘触发区 → 展开
                        if cx >= right - EDGE && cy >= top && cy <= bottom {
                            apply_mode(&app, M_EXPANDED, true);
                        }
                    }
                    M_EXPANDED => {
                        // 鼠标移出面板矩形 → 收回细条
                        let left = right - PANEL_W;
                        if cx < left || cx > right + 1.0 || cy < top || cy > bottom {
                            apply_mode(&app, M_COLLAPSED, false);
                        }
                    }
                    _ => {}
                }
            }
        }
        std::thread::sleep(Duration::from_millis(POLL_MS));
    });
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let toggle_i = MenuItemBuilder::with_id("toggle", "显示 / 隐藏").build(app)?;
    let pin_i = CheckMenuItemBuilder::with_id("pin", "锁定面板（划过不收回）").build(app)?;
    let wide_i = MenuItemBuilder::with_id("wide", "切换宽窗模式").build(app)?;
    let auto_i = CheckMenuItemBuilder::with_id("autostart", "开机自启").build(app)?;
    let quit_i = MenuItemBuilder::with_id("quit", "退出 DayCell").build(app)?;
    let menu = Menu::with_items(app, &[&toggle_i, &pin_i, &wide_i, &auto_i, &quit_i])?;

    // 初始化自启勾选态
    if let Ok(true) = app.autolaunch().is_enabled() {
        let _ = auto_i.set_checked(true);
    }

    // 菜单事件闭包直接持有菜单项引用（避免依赖 tray.menu() 的运行时查询）
    let pin_handle = pin_i.clone();
    let auto_handle = auto_i.clone();

    let icon = app.default_window_icon().cloned().expect("窗口图标缺失");
    TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => toggle(app),
            "pin" => {
                let cur = PINNED.load(Ordering::Relaxed);
                PINNED.store(!cur, Ordering::Relaxed);
                let _ = pin_handle.set_checked(!cur);
            }
            "wide" => {
                let m = MODE.load(Ordering::Relaxed);
                let next = if m == M_WIDE { M_EXPANDED } else { M_WIDE };
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
                let m = MODE.load(Ordering::Relaxed);
                let next = if m == M_COLLAPSED { M_EXPANDED } else { M_COLLAPSED };
                apply_mode(app, next, true);
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
        .setup(|app| {
            let handle = app.handle().clone();
            // 启动即收成细条贴右缘
            apply_mode(&handle, M_COLLAPSED, false);
            // 全局热键：展开/收起
            app.global_shortcut().on_shortcut("CmdOrCtrl+Shift+D", |app, _shortcut, ev| {
                if ev.state() == ShortcutState::Pressed {
                    toggle(app);
                }
            })?;
            // 菜单栏托盘
            build_tray(&handle)?;
            // 边缘监听轮询
            edge_loop(handle);
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
