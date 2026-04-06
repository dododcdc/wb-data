from pathlib import Path
import json
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:5173"
API_URL = "http://127.0.0.1:8080"
OUTPUT_DIR = Path("/Users/wenbin/Projects/wb-data/output/playwright")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def save(page, name: str) -> None:
    page.screenshot(path=str(OUTPUT_DIR / name), full_page=True)


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


with sync_playwright() as p:
    token = fetch_token()
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1366, "height": 960})

    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    save(page, "login-redesign-check.png")

    page.goto(BASE_URL, wait_until="networkidle")
    page.evaluate(
        "(authToken) => window.localStorage.setItem('wb_data_auth_token', authToken)",
        token,
    )

    page.goto(f"{BASE_URL}/system-admin", wait_until="networkidle")
    save(page, "system-admin-redesign-check.png")

    page.goto(f"{BASE_URL}/members", wait_until="networkidle")
    save(page, "members-redesign-check.png")

    page.goto(f"{BASE_URL}/group-settings", wait_until="networkidle")
    save(page, "group-settings-redesign-check.png")

    page.goto(f"{BASE_URL}/no-groups", wait_until="networkidle")
    save(page, "no-groups-redesign-check.png")

    mobile = browser.new_page(viewport={"width": 390, "height": 844})
    mobile.goto(f"{BASE_URL}/login", wait_until="networkidle")
    save(mobile, "login-redesign-check-mobile.png")
    mobile.close()

    browser.close()
