from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5173"
USERNAME = "admin"
PASSWORD = "admin123456"
SQL = "select id, name, price, stock_quantity from products order by id limit 3"
ARTIFACT_DIR = Path("/Users/wenbin/Projects/wb-data/output/playwright")
SCREENSHOT_PATH = ARTIFACT_DIR / "query-ui-smoke.png"
DOWNLOAD_PATH = ARTIFACT_DIR / "query-ui-export.csv"


def wait_for_export_success(page):
    for _ in range(12):
        status_locator = page.locator(".export-task-item").first.locator(".export-task-status")
        status_text = status_locator.inner_text(timeout=5000)
        if "已完成" in status_text:
            return status_text
        page.locator(".export-tasks-refresh").click()
        page.wait_for_timeout(1000)
    raise AssertionError("导出任务未在预期时间内完成")


def main():
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(accept_downloads=True)
        page = context.new_page()
        page.set_viewport_size({"width": 1600, "height": 1100})

        try:
            page.goto(f"{BASE_URL}/login", wait_until="networkidle")
            page.get_by_placeholder("请输入用户名").fill(USERNAME)
            page.get_by_placeholder("请输入密码").fill(PASSWORD)
            page.get_by_role("button", name="登录").click()
            page.wait_for_timeout(1500)

            page.goto(f"{BASE_URL}/query", wait_until="networkidle")
            page.get_by_text("products", exact=True).wait_for(timeout=10000)

            page.locator(".monaco-editor .view-lines").click(position={"x": 24, "y": 16}, force=True)
            page.keyboard.press("Meta+A")
            page.keyboard.insert_text(SQL)

            page.get_by_label("执行 SQL").click()
            page.wait_for_load_state("networkidle")
            page.get_by_text("玫瑰花束", exact=True).wait_for(timeout=10000)
            page.get_by_text("精品玫瑰花束(生日)", exact=True).wait_for(timeout=10000)

            page.get_by_label("钉住当前结果").click()
            page.get_by_text("已保存到当前项目组图钉").wait_for(timeout=10000)

            page.reload(wait_until="networkidle")
            page.get_by_role("button", name="回填 SQL").wait_for(timeout=10000)
            page.get_by_text("豪华玫瑰花束(纪念日)", exact=True).wait_for(timeout=10000)

            page.get_by_role("button", name="导出", exact=True).click()
            page.get_by_role("menuitem", name="导出 CSV").click()
            page.locator(".export-tasks-button").click(force=True)
            page.locator(".export-tasks-menu").wait_for(timeout=10000)
            page.locator(".export-task-item").first.wait_for(timeout=10000)
            wait_for_export_success(page)

            with page.expect_download(timeout=10000) as download_info:
                page.locator(".export-task-item").first.locator(".export-task-download").click()
            download = download_info.value
            download.save_as(DOWNLOAD_PATH)

            export_head = DOWNLOAD_PATH.read_text(encoding="utf-8-sig").splitlines()[:4]
            if len(export_head) < 4 or "玫瑰花束" not in export_head[1]:
                raise AssertionError("下载文件内容不符合预期")

            close_buttons = page.locator(".result-tab-pinned .result-tab-close")
            if close_buttons.count() > 0:
                close_buttons.first.click()
                page.wait_for_timeout(500)

            page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)

            print("UI_SMOKE_OK")
            print(f"screenshot={SCREENSHOT_PATH}")
            print(f"download={DOWNLOAD_PATH}")
            for line in export_head:
                print(line)
        except PlaywrightTimeoutError as exc:
            page.screenshot(path=str(SCREENSHOT_PATH), full_page=True)
            raise AssertionError(f"页面联调超时: {exc}") from exc
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
