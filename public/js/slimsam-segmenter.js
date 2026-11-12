/* ==========================================================================
   ArcSite Studio — In-Browser SlimSAM Segmenter (WebGPU / ONNX WASM)
   Zero-backend, zero-API-cost deep-learning segmentation for Trace Click.
   Lazy-loads @huggingface/transformers + Xenova/slimsam-77-uniform on demand
   and caches map image embeddings per image URL.
   ========================================================================== */

(function () {
  'use strict';

  const TRANSFORMERS_ESM = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.0/+esm';
  const MODEL_ID = 'Xenova/slimsam-77-uniform';

  const state = {
    lib: null,
    model: null,
    processor: null,
    device: 'wasm',
    loadingPromise: null,
    cachedEmbed: null, // { src, rawImage, rawW, rawH, imageEmbeddings, originalSizes, reshapedInputSizes }
  };

  async function detectDevice() {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) return 'webgpu';
      } catch {
        // Fallback to WASM
      }
    }
    return 'wasm';
  }

  async function ensureModel(onStatus) {
    if (state.model && state.processor) return state;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async () => {
      try {
        if (onStatus) onStatus('Checking WebGPU support & loading Transformers.js…');
        const lib = await import(TRANSFORMERS_ESM);
        lib.env.allowLocalModels = false;
        state.lib = lib;

        const preferred = await detectDevice();
        let model = null;
        try {
          if (onStatus) onStatus(`Loading SlimSAM (${preferred.toUpperCase()})…`);
          model = await lib.SamModel.from_pretrained(MODEL_ID, {
            device: preferred,
            dtype: preferred === 'webgpu' ? 'fp32' : 'q8',
          });
          state.device = preferred;
        } catch (webgpuErr) {
          if (preferred !== 'wasm') {
            if (onStatus) onStatus('WebGPU unavailable — falling back to WASM SlimSAM…');
            model = await lib.SamModel.from_pretrained(MODEL_ID, {
              device: 'wasm',
              dtype: 'q8',
            });
            state.device = 'wasm';
          } else {
            throw webgpuErr;
          }
        }

        const processor = await lib.AutoProcessor.from_pretrained(MODEL_ID);
        state.model = model;
        state.processor = processor;
        return state;
      } catch (err) {
        state.loadingPromise = null;
        throw err;
      }
    })();

    return state.loadingPromise;
  }

  function rasterizeImageToCanvas(imgEl, maxDim = 1024) {
    const scale = Math.min(1, maxDim / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
    const w = Math.max(64, Math.round(imgEl.naturalWidth * scale));
    const h = Math.max(64, Math.round(imgEl.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(imgEl, 0, 0, w, h);
    return { canvas, w, h };
  }

  async function ensureImageEmbeddings(imgEl, onStatus) {
    const src = imgEl.currentSrc || imgEl.src;
    if (state.cachedEmbed && state.cachedEmbed.src === src) {
      return state.cachedEmbed;
    }
    const { lib, model, processor, device } = await ensureModel(onStatus);
    if (onStatus) onStatus(`Encoding map image with SlimSAM (${device.toUpperCase()})…`);

    const { canvas, w, h } = rasterizeImageToCanvas(imgEl, 1024);
    const rawImage = lib.RawImage.fromCanvas(canvas);
    const processed = await processor(rawImage);
    const imageEmbeddings = await model.get_image_embeddings(processed);

    state.cachedEmbed = {
      src,
      rawImage,
      rawW: w,
      rawH: h,
      imageEmbeddings,
      originalSizes: processed.original_sizes,
      reshapedInputSizes: processed.reshaped_input_sizes,
    };
    return state.cachedEmbed;
  }

  function extractBestBinaryMask(masksTensor, iouTensor, w, h) {
    const scores = iouTensor?.data || [];
    const numMasks = scores.length || 1;
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < numMasks; i++) {
      if (scores[i] > bestScore) {
        bestScore = scores[i];
        bestIdx = i;
      }
    }

    const maskObj = Array.isArray(masksTensor) ? masksTensor[0] : masksTensor;
    const data = maskObj?.data;
    if (!data || data.length < w * h) return null;

    // SAM output tensor is shaped [batch=1, numMasks, H, W] or [numMasks, H, W]
    const planeSize = w * h;
    const offset = data.length >= planeSize * (bestIdx + 1) ? bestIdx * planeSize : 0;
    const binMask = new Uint8Array(planeSize);
    let area = 0;
    let minX = w, minY = h, maxX = 0, maxY = 0;

    for (let p = 0; p < planeSize; p++) {
      if (data[offset + p] > 0) {
        binMask[p] = 1;
        area++;
        const x = p % w;
        const y = (p - x) / w;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    if (area < Math.round(planeSize * 0.0008) || area > Math.round(planeSize * 0.45)) {
      return null;
    }
    const solidity = area / Math.max(1, (maxX - minX + 1) * (maxY - minY + 1));
    return { binMask, area, solidity, score: bestScore };
  }

  async function segmentAtPoint(imgEl, xPct, yPct, onStatus) {
    if (!imgEl || !imgEl.naturalWidth || !window.SmartAssist?.maskToPctResult) return null;
    const embed = await ensureImageEmbeddings(imgEl, onStatus);
    if (onStatus) onStatus('Tracing AI mask boundary…');

    const px = Math.max(0, Math.min(embed.rawW - 1, Math.round((xPct / 100) * embed.rawW)));
    const py = Math.max(0, Math.min(embed.rawH - 1, Math.round((yPct / 100) * embed.rawH)));

    const pointInputs = await state.processor(embed.rawImage, {
      input_points: [[[px, py]]],
      input_labels: [[1]],
    });

    const outputs = await state.model({
      ...embed.imageEmbeddings,
      input_points: pointInputs.input_points,
      input_labels: pointInputs.input_labels,
    });

    const masks = await state.processor.post_process_masks(
      outputs.pred_masks,
      embed.originalSizes,
      embed.reshapedInputSizes
    );

    const best = extractBestBinaryMask(masks, outputs.iou_scores, embed.rawW, embed.rawH);
    if (!best) return null;

    const polyResult = window.SmartAssist.maskToPctResult(
      best.binMask,
      embed.rawW,
      embed.rawH,
      xPct,
      yPct,
      best.solidity
    );
    if (!polyResult) return null;
    polyResult.source = `slimsam-${state.device}`;
    polyResult.iouScore = best.score;
    return polyResult;
  }

  function clearCache() {
    state.cachedEmbed = null;
  }

  function isReady() {
    return !!(state.model && state.processor);
  }

  function getDevice() {
    return state.device;
  }

  window.SlimSamSegmenter = {
    detectDevice,
    ensureModel,
    ensureImageEmbeddings,
    segmentAtPoint,
    clearCache,
    isReady,
    getDevice,
  };
})();

