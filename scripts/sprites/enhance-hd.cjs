/**
 * scripts/sprites/enhance-hd.cjs
 * 캐릭터 사진/스프라이트 에셋(web/sprites/*.png)을 2배 초고해상도(2048px급)로 업스케일하고,
 * 1) 외곽선 흰색/회색 배경 번짐 제거(Color Decontamination & Smooth Alpha Matting)
 * 2) 실루엣 거리장(Distance Field) 기반 3D 입체 볼륨 셰이딩(Key Light · Rim Light · 하단 AO)
 * 3) 에지 보존 선명화(Edge-Preserving Unsharp Mask & Micro-Contrast)
 * 를 적용하여 깨끗한 실사풍 3D 렌더 품질로 고도화한다.
 *
 * 실행: NODE_PATH=/tmp/agent-office-assets/node_modules node scripts/sprites/enhance-hd.cjs
 */
const fs = require("fs");
const path = require("path");
const { createCanvas, loadImage, ImageData } = require("@napi-rs/canvas");

const ROOT = path.resolve(__dirname, "../..");
const SPRITES_DIR = path.join(ROOT, "web/sprites");

const clamp = (v, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 1단계: 원본 시트(docs/ref/characters-office-life-v1.png, characters-seated-work-v1.png)에서
 * 흰색 배경 테두리 없이 깨끗하게 마스킹된 고해상도 프레임을 먼저 재추출한다.
 */
async function rebuildCleanLifeAndWork() {
  // 1) characters-office-life-v1.png (소파 착석 lounge · 커피 타임 tea · 발표 present)
  const lifePath = path.join(ROOT, "docs/ref/characters-office-life-v1.png");
  if (fs.existsSync(lifePath)) {
    const im = await loadImage(lifePath);
    const srcCv = createCanvas(im.width, im.height);
    const srcCtx = srcCv.getContext("2d");
    srcCtx.drawImage(im, 0, 0);

    const xs = [0, 341, 683, 1024];
    const ys = [0, 512, 1024, 1536];
    const names = ["claude", "gpt", "gemini"];
    const poses = ["lounge", "tea", "present"];
    const heights = { claude: 1.72, gpt: 1.78, gemini: 1.68 };
    const meta = { source: "docs/ref/characters-office-life-v1.png", chars: {} };

    for (let row = 0; row < 3; row++) {
      const name = names[row];
      const atlas = createCanvas(1024, 512);
      const aCtx = atlas.getContext("2d");
      const frames = {};
      let x = 2;

      for (let col = 0; col < 3; col++) {
        const pose = poses[col];
        const cw = xs[col + 1] - xs[col], ch = ys[row + 1] - ys[row];
        const imgData = srcCtx.getImageData(xs[col], ys[row], cw, ch);
        const d = imgData.data;

        // 소프트 알파 매팅 + 흰 배경 색 번짐 제거
        let minX = cw, minY = ch, maxX = 0, maxY = 0;
        for (let py = 0; py < ch; py++) {
          for (let px = 0; px < cw; px++) {
            const idx = (py * cw + px) * 4;
            const a = d[idx + 3];
            // 소프트 램프: 48 이하는 0, 48~180 사이는 부드러운 곡선으로 매팅
            const na = a <= 48 ? 0 : a >= 210 ? 255 : Math.round(((a - 48) / 162) * 255);
            d[idx + 3] = na;
            if (na > 8) {
              if (px < minX) minX = px;
              if (px > maxX) maxX = px;
              if (py < minY) minY = py;
              if (py > maxY) maxY = py;
            } else {
              d[idx] = d[idx + 1] = d[idx + 2] = d[idx + 3] = 0;
            }
          }
        }

        const fw = maxX - minX + 1, fh = maxY - minY + 1;
        const cellCv = createCanvas(fw, fh);
        const cellCtx = cellCv.getContext("2d");
        cellCtx.putImageData(imgData, -minX, -minY);

        const h = pose === "lounge" ? 1.22 : heights[name];
        const ax = fw * (pose === "lounge" ? 0.32 : 0.5);
        aCtx.drawImage(cellCv, x, 2);
        frames[pose] = [x, 2, fw, fh, Number(ax.toFixed(2)), Number((fh / h).toFixed(4))];
        x += fw + 4;
      }

      fs.writeFileSync(path.join(SPRITES_DIR, `${name}-life.png`), atlas.toBuffer("image/png"));
      meta.chars[name] = { atlas: `sprites/${name}-life.png`, size: [1024, 512], frames };
    }

    fs.writeFileSync(
      path.join(SPRITES_DIR, "office-life.js"),
      "/* scripts/sprites/office-life.py 생성 — 직접 수정 금지 */\nwindow.OFFICE_LIFE_META = " + JSON.stringify(meta) + ";\n",
      "utf8"
    );
  }
}

/**
 * 2단계: RGBA 버퍼에 대해
 *  - 배경 흰색 번짐 제거 (Foreground Color Unmixing / Edge Decontamination)
 *  - 실루엣 내부 거리장(Chamfer Distance Field) 계산을 통한 3D 입체 릴리프 & 림라이트·AO 셰이딩
 *  - 에지 보존 언샵 마스크(Unsharp Mask) 및 미세 대비(Micro-contrast) 향상
 */
function enhanceRGBA(imgData, isFaceStrip = false) {
  const w = imgData.width, h = imgData.height;
  const src = new Uint8ClampedArray(imgData.data);
  const dst = imgData.data;

  if (!isFaceStrip) {
    // A. 가장자리 흰색/배경 번짐 제거 (불투명 내부 픽셀 색으로 반투명 외곽 픽셀 복원)
    const solidR = new Uint8Array(w * h);
    const solidG = new Uint8Array(w * h);
    const solidB = new Uint8Array(w * h);
    const hasSolid = new Uint8Array(w * h);

    for (let i = 0; i < w * h; i++) {
      const a = src[i * 4 + 3];
      if (a >= 225) {
        hasSolid[i] = 1;
        solidR[i] = src[i * 4];
        solidG[i] = src[i * 4 + 1];
        solidB[i] = src[i * 4 + 2];
      }
    }

    // 4패스 최근접 불투명 색 전파 (외곽 반투명 픽셀의 흰 테두리 오염 제거)
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (hasSolid[i]) continue;
          const nbs = [i - 1, i + 1, i - w, i + w, i - w - 1, i - w + 1, i + w - 1, i + w + 1];
          let sr = 0, sg = 0, sb = 0, cnt = 0;
          for (const nb of nbs) {
            if (hasSolid[nb]) {
              sr += solidR[nb]; sg += solidG[nb]; sb += solidB[nb]; cnt++;
            }
          }
          if (cnt > 0) {
            hasSolid[i] = 2;
            solidR[i] = (sr / cnt) | 0;
            solidG[i] = (sg / cnt) | 0;
            solidB[i] = (sb / cnt) | 0;
          }
        }
      }
      for (let i = 0; i < w * h; i++) if (hasSolid[i] === 2) hasSolid[i] = 1;
    }

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      const a = src[idx + 3];
      if (a > 0 && a < 235 && hasSolid[i]) {
        const af = Math.max(0.35, a / 255);
        // 흰 배경(248,248,250) 오염 역산 + 내부 불투명 색과 자연스럽게 블렌딩
        const unmixR = clamp((src[idx] - (1 - af) * 246) / af);
        const unmixG = clamp((src[idx + 1] - (1 - af) * 246) / af);
        const unmixB = clamp((src[idx + 2] - (1 - af) * 248) / af);
        const mix = a / 235;
        src[idx]     = (unmixR * mix + solidR[i] * (1 - mix)) | 0;
        src[idx + 1] = (unmixG * mix + solidG[i] * (1 - mix)) | 0;
        src[idx + 2] = (unmixB * mix + solidB[i] * (1 - mix)) | 0;
      }
    }

    // B. 실루엣 내부 거리장(Chamfer Distance Transform)으로 3D 볼륨 노멀 & 림라이트 계산
    const dist = new Float32Array(w * h);
    const INF = 1e6;
    for (let i = 0; i < w * h; i++) {
      dist[i] = src[i * 4 + 3] > 32 ? INF : 0;
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (dist[i] === 0) continue;
        const d1 = Math.min(dist[i - 1] + 1, dist[i - w] + 1, dist[i - w - 1] + 1.414, dist[i - w + 1] + 1.414);
        if (d1 < dist[i]) dist[i] = d1;
      }
    }
    for (let y = h - 2; y >= 1; y--) {
      for (let x = w - 2; x >= 1; x--) {
        const i = y * w + x;
        if (dist[i] === 0) continue;
        const d2 = Math.min(dist[i + 1] + 1, dist[i + w] + 1, dist[i + w - 1] + 1.414, dist[i + w + 1] + 1.414);
        if (d2 < dist[i]) dist[i] = d2;
      }
    }

    // 3D 볼륨 셰이딩 적용 (중심부는 은은한 하이라이트, 외곽선은 부드러운 입체 곡률 + 상단 키라이트)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const idx = i * 4;
        const a = src[idx + 3];
        if (a <= 8) continue;

        const dVal = Math.min(28, dist[i]);
        // 실루엣 곡면 노멀 근사
        const gx = (dist[i + 1] - dist[i - 1]) * 0.5;
        const gy = (dist[i + w] - dist[i - w]) * 0.5;
        // 좌상단 키 라이트 방향(-0.45, -0.55)과 곡면 기울기 내적
        const directional = clamp((gx * -0.45 + gy * -0.55) * 0.045, -0.06, 0.07);
        // 중심부 돔 볼륨감 (가장자리에서 중심으로 갈수록 입체감 상승)
        const dome = (Math.sin(Math.min(1, dVal / 18) * (Math.PI / 2)) - 0.35) * 0.045;
        // 외곽 림라이트 (배경과 분리되는 깔끔한 3D 스튜디오 윤곽광)
        const rim = (dVal >= 1.5 && dVal <= 4.5 && gy > -0.2) ? 0.032 : 0;

        const gain = 1.0 + directional + dome + rim;
        src[idx]     = clamp(src[idx] * gain);
        src[idx + 1] = clamp(src[idx + 1] * gain);
        src[idx + 2] = clamp(src[idx + 2] * gain);
      }
    }
  }

  // C. 에지 보존 언샵 마스크 (Edge-Preserving Unsharp Mask — 눈·안경·머리카락·사원증 선명도 대폭 향상)
  const amount = isFaceStrip ? 0.68 : 0.62;
  const threshold = 3;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const idx = i * 4;
      const a = src[idx + 3];
      if (!isFaceStrip && a < 16) {
        dst[idx] = dst[idx + 1] = dst[idx + 2] = dst[idx + 3] = 0;
        continue;
      }
      // 3x3 가우시안 블러 커널
      for (let c = 0; c < 3; c++) {
        const center = src[idx + c];
        const blur = (
          center * 4 +
          (src[idx - 4 + c] + src[idx + 4 + c] + src[idx - w * 4 + c] + src[idx + w * 4 + c]) * 2 +
          (src[idx - w * 4 - 4 + c] + src[idx - w * 4 + 4 + c] + src[idx + w * 4 - 4 + c] + src[idx + w * 4 + 4 + c])
        ) / 16;
        const diff = center - blur;
        // 너무 큰 경계(할로 방지)는 완화하고, 중간 디테일(눈동자·머리카락 결·옷 주름)을 선명하게 강조
        const boost = Math.abs(diff) < threshold ? 0 : Math.abs(diff) > 48 ? diff * 0.25 : diff * amount;
        // 미세 S-커브 대비 보정
        const v = clamp(center + boost);
        const norm = v / 255;
        const scurve = norm + 0.06 * Math.sin( (norm - 0.5) * Math.PI );
        dst[idx + c] = clamp(Math.round(scurve * 255));
      }
      // 알파 채널 외곽선 소프트 안티앨리어싱
      if (!isFaceStrip && a > 16 && a < 245) {
        const avgA = (
          a * 4 +
          src[idx - 1] + src[idx + 7] + src[idx - w * 4 + 3] + src[idx + w * 4 + 3]
        ) / 8;
        dst[idx + 3] = clamp(Math.round(avgA));
      } else {
        dst[idx + 3] = isFaceStrip ? 255 : a;
      }
    }
  }
}

async function processAllSprites() {
  await rebuildCleanLifeAndWork();

  const files = [
    "claude.png", "gpt.png", "gemini.png",
    "claude-work.png", "gpt-work.png", "gemini-work.png",
    "claude-life.png", "gpt-life.png", "gemini-life.png",
    "claude-faces.png", "gpt-faces.png", "gemini-faces.png",
  ];

  // 원본 백업(한 번만 생성하여 언제든 재실행 가능하도록 보장)
  const backupDir = path.join(SPRITES_DIR, ".orig");
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    for (const f of files) {
      const p = path.join(SPRITES_DIR, f);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(backupDir, f));
    }
  } else {
    // life 시트는 방금 새로 추출했으므로 백업도 최신 클린 버전으로 갱신
    for (const f of ["claude-life.png", "gpt-life.png", "gemini-life.png"]) {
      const p = path.join(SPRITES_DIR, f);
      if (fs.existsSync(p)) fs.copyFileSync(p, path.join(backupDir, f));
    }
  }

  for (const f of files) {
    const srcPath = path.join(backupDir, f);
    const outPath = path.join(SPRITES_DIR, f);
    if (!fs.existsSync(srcPath)) continue;

    const im = await loadImage(srcPath);
    const isFace = f.endsWith("-faces.png");
    // 2배 초고해상도 업스케일 (예: 1024x256 -> 2048x512, 1024x512 -> 2048x1024, 408x68 -> 816x136)
    const targetW = im.width * 2;
    const targetH = im.height * 2;

    const cv = createCanvas(targetW, targetH);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(im, 0, 0, targetW, targetH);

    const imgData = ctx.getImageData(0, 0, targetW, targetH);
    enhanceRGBA(imgData, isFace);
    ctx.putImageData(imgData, 0, 0);

    fs.writeFileSync(outPath, cv.toBuffer("image/png"));
    console.log(`HD Enhanced: ${f.padEnd(20)} ${im.width}x${im.height} -> ${targetW}x${targetH}`);
  }
}

processAllSprites().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
