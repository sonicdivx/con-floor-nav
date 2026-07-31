import { Capacitor } from '@capacitor/core'

/** Visible status for Capacitor / Android sideload (phase 3). */
export function NativeAppPanel() {
  const platform = Capacitor.getPlatform()
  const native = Capacitor.isNativePlatform()

  return (
    <div className="stack-panel">
      <h3>Native app (Android)</h3>
      <p className="muted">
        Phase 3: Capacitor wraps this PWA so you can sideload an APK. PWA install stays the primary
        path; use Android when home-screen install is not enough.
      </p>
      <dl className="settings-kv">
        <div>
          <dt>Runtime</dt>
          <dd>{native ? `Capacitor (${platform})` : `Web / PWA (${platform})`}</dd>
        </div>
        <div>
          <dt>App ID</dt>
          <dd>
            <code>app.confloornav.pwa</code>
          </dd>
        </div>
        <div>
          <dt>Project</dt>
          <dd>
            <code>android/</code> + <code>capacitor.config.ts</code> in the repo
          </dd>
        </div>
      </dl>
      <p className="muted sm">
        On a machine with Android Studio:
      </p>
      <pre className="code-block">{`npm run cap:sync
npm run cap:open`}</pre>
      <p className="muted sm">
        Then Build → Build APK(s) and install on a device. iOS/TestFlight needs an Apple Developer
        account and is not scaffolded yet.
      </p>
    </div>
  )
}
