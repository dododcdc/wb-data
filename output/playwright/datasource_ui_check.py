from pathlib import Path
import json
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5173"
API_URL = "http://127.0.0.1:8080"
OUTPUT_DIR = Path("/Users/wenbin/Projects/wb-data/output/playwright")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def fetch_token() -> str:
    request = Request(
        f"{API_URL}/api/v1/auth/login",
        data=json.dumps({"username": "admin", "password": "admin123456"}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload["data"]["token"]


def save(page, name: str) -> None:
    page.screenshot(path=str(OUTPUT_DIR / name), full_page=True)


with sync_playwright() as p:
    token = fetch_token()
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 980})
    page.goto(BASE_URL, wait_until="networkidle")
    page.evaluate(
        "(authToken) => window.localStorage.setItem('wb_data_auth_token', authToken)",
        token,
    )

    page.goto(f"{BASE_URL}/", wait_until="networkidle")
    save(page, "dashboard-polish-check.png")

    page.goto(f"{BASE_URL}/datasources", wait_until="networkidle")
    save(page, "datasources-polish-check.png")

    create_button = page.get_by_role("button", name="新建数据源")
    if create_button.count() > 0:
        create_button.click()
        page.wait_for_timeout(300)
        save(page, "datasource-form-polish-check.png")

    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(BASE_URL, wait_until="networkidle")
    mobile.evaluate(
        "(authToken) => window.localStorage.setItem('wb_data_auth_token', authToken)",
        token,
    )
    mobile.goto(f"{BASE_URL}/datasources", wait_until="networkidle")
    save(mobile, "datasources-polish-check-mobile.png")
    mobile.close()

    browser.close()
