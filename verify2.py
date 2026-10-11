from playwright.sync_api import sync_playwright

def run_cuj(page):
    page.goto("http://localhost:5173")
    page.wait_for_timeout(500)

    # Evaluate a mock script to bypass the actual authentication
    page.evaluate("""
        const mockAuthSession = {
            access_token: 'mock_token',
            refresh_token: 'mock_refresh',
            user: {
                id: 'mock_responder_id',
                aud: 'authenticated',
                role: 'authenticated',
                email: 'responder@test.com',
                phone: '',
                app_metadata: { provider: 'email', providers: ['email'] },
                user_metadata: {},
                identities: [],
                created_at: '2023-01-01T00:00:00Z',
                updated_at: '2023-01-01T00:00:00Z'
            },
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            token_type: 'bearer'
        };
        localStorage.setItem('sb-agapsense-auth-token', JSON.stringify(mockAuthSession));
    """)

    # We also need to mock the Supabase API call that fetches the profile, or intercept it.
    # Let's route the API call to return a mock profile.
    page.route("**/rest/v1/profiles*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[{"id":"mock_responder_id","role":"bfp_responder","status":"approved","setup_complete":true,"created_at":"2023-01-01T00:00:00Z"}]'
    ))

    # We'll also need to mock the devices API call.
    page.route("**/rest/v1/devices*", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body='[]'
    ))

    page.goto("http://localhost:5173/responder/settings")
    page.wait_for_timeout(2000)

    # Take screenshot at the key moment
    page.screenshot(path="/home/jules/verification/screenshots/settings.png", full_page=True)
    page.wait_for_timeout(1000)  # Hold final state for the video

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()
        try:
            run_cuj(page)
        finally:
            context.close()  # MUST close context to save the video
            browser.close()
