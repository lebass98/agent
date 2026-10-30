package com.wordncode.agentoffice;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

/**
 * 에이전트 오피스 웹 UI 를 띄우는 껍데기 앱.
 * AI 실행은 컴퓨터의 serve.py(--lan)가 하고, 앱은 그 주소(접속 키 포함)를 열기만 한다.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "agent";
    private static final String KEY_URL = "server_url";
    private String DEFAULT_URL;

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        DEFAULT_URL = getString(R.string.default_url);

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showError(String.valueOf(err.getDescription()));
            }
        });
        setContentView(web);

        if (state != null) web.restoreState(state);
        else web.loadUrl(prefs.getString(KEY_URL, DEFAULT_URL));
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    /** 서버 주소 입력 창. 컴퓨터 터미널에 나온 '휴대폰 주소'(?key=… 포함)를 붙여 넣는다. */
    private void askUrl(String message) {
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(prefs.getString(KEY_URL, DEFAULT_URL));
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle("서버 주소")
                .setMessage(message != null ? message
                        : "컴퓨터에서 serve.py --lan 을 켜고 나온 휴대폰 주소를 붙여 넣으세요.")
                .setView(input)
                .setCancelable(false)
                .setPositiveButton("열기", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (!url.startsWith("http")) url = "http://" + url;
                    prefs.edit().putString(KEY_URL, url).apply();
                    web.loadUrl(url);
                })
                .show();
    }

    private void showError(String why) {
        askUrl("서버에 연결하지 못했습니다(" + why + ").\n컴퓨터 서버와 Tailscale 이 켜져 있는지 확인하고, 주소를 다시 확인하세요.");
    }
}
