package com.wordncode.agentoffice;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.app.ProgressDialog;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 앱 안 업데이트: 컴퓨터 서버의 /api/app/latest 를 보고 새 버전이면 /api/app/apk 를 받아 설치 창을 띄운다.
 * 릴리즈는 컴퓨터에서 scripts/release.py 가 만든다(dist/latest.json + APK).
 */
class Updater {
    private static final String ACTION_STATUS = "com.wordncode.agentoffice.INSTALL_STATUS";

    private final Activity act;
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean busy;

    Updater(Activity act) {
        this.act = act;
    }

    /** quiet=true: 새 버전이 없거나 서버에 못 닿으면 아무것도 보이지 않는다(앱을 열 때 자동 확인). */
    void check(String serverUrl, boolean quiet) {
        if (busy) return;
        busy = true;
        new Thread(() -> {
            try {
                Uri u = Uri.parse(serverUrl);
                String base = u.getScheme() + "://" + u.getAuthority();
                String key = u.getQueryParameter("key");
                JSONObject latest = new JSONObject(new String(get(base + "/api/app/latest", key), "UTF-8"));
                long remote = latest.getLong("versionCode");
                long local = currentVersionCode();
                main.post(() -> {
                    busy = false;
                    if (remote > local) offer(base, key, latest);
                    else if (!quiet) toast("최신 버전입니다 (" + currentVersionName() + ")");
                });
            } catch (Exception e) {
                main.post(() -> {
                    busy = false;
                    if (!quiet) toast("업데이트 확인 실패: " + e.getMessage());
                });
            }
        }).start();
    }

    private void offer(String base, String key, JSONObject latest) {
        String notes = latest.optString("notes", "").trim();
        new AlertDialog.Builder(act)
                .setTitle("새 버전 " + latest.optString("versionName") + " 이 있습니다")
                .setMessage("지금 버전: " + currentVersionName() + (notes.isEmpty() ? "" : "\n\n" + notes))
                .setPositiveButton("업데이트", (d, w) -> download(base, key))
                .setNegativeButton("나중에", null)
                .show();
    }

    private void download(String base, String key) {
        if (Build.VERSION.SDK_INT >= 26 && !act.getPackageManager().canRequestPackageInstalls()) {
            toast("'이 출처의 앱 설치'를 허용한 뒤 다시 눌러 주세요");
            act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + act.getPackageName())));
            return;
        }
        ProgressDialog progress = ProgressDialog.show(act, null, "새 버전 받는 중…", true, false);
        new Thread(() -> {
            try {
                byte[] apk = get(base + "/api/app/apk", key);
                install(apk);
                main.post(progress::dismiss);
            } catch (Exception e) {
                main.post(() -> {
                    progress.dismiss();
                    toast("업데이트 실패: " + e.getMessage());
                });
            }
        }).start();
    }

    /** PackageInstaller 세션으로 설치 — 사용자 확인 창은 시스템이 띄운다. */
    private void install(byte[] apk) throws Exception {
        PackageInstaller pi = act.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        int id = pi.createSession(params);
        try (PackageInstaller.Session s = pi.openSession(id)) {
            try (OutputStream out = s.openWrite("app.apk", 0, apk.length)) {
                out.write(apk);
                s.fsync(out);
            }
            registerStatus();
            Intent i = new Intent(ACTION_STATUS).setPackage(act.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(act, id, i, flags).getIntentSender());
        }
    }

    private boolean registered;

    private void registerStatus() {
        if (registered) return;
        registered = true;
        BroadcastReceiver r = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) act.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } else if (status != PackageInstaller.STATUS_SUCCESS) {
                    toast("설치하지 못했습니다: " + i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
                }
            }
        };
        IntentFilter f = new IntentFilter(ACTION_STATUS);
        if (Build.VERSION.SDK_INT >= 33) act.registerReceiver(r, f, Context.RECEIVER_NOT_EXPORTED);
        else act.registerReceiver(r, f);
    }

    private static byte[] get(String url, String key) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(60000);
        if (key != null) c.setRequestProperty("X-Access-Key", key);
        int code = c.getResponseCode();
        if (code != 200) throw new Exception(code == 404 ? "서버에 릴리즈가 없습니다" : "HTTP " + code);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    String currentVersionName() {
        try {
            return info().versionName;
        } catch (Exception e) {
            return "?";
        }
    }

    @SuppressWarnings("deprecation")
    private long currentVersionCode() throws Exception {
        PackageInfo p = info();
        return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
    }

    private PackageInfo info() throws Exception {
        return act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
    }

    private void toast(String msg) {
        Toast.makeText(act, msg, Toast.LENGTH_LONG).show();
    }
}
