/* ================================================================
   Spine 渲染 — 共享 WebGL 上下文 + 视口裁剪渲染
   核心优化：所有 Spine 节点共享一个 WebGL 上下文，突破浏览器上下文上限
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 共享 WebGL 状态 ----
SMTool._sharedCanvas = null;
SMTool._sharedGL = null;

// ---- 纹理共享缓存 ----
// 结构：{ "texDataUrl||pageIdx": { texture: GLTexture, refCount: number } }
// 同一 Spine 源文件的多个节点共享 GL 纹理，避免重复创建
SMTool._texCache = {};

// 获取或创建共享纹理
SMTool._getOrCreateTex38 = function (gl, WGL, texDataUrl, pageIdx, img) {
    var key = texDataUrl + '||' + pageIdx;
    var entry = SMTool._texCache[key];
    if (entry) {
        entry.refCount++;
        return entry.texture;
    }
    var glTex = new WGL.GLTexture(gl, img, false);
    SMTool._texCache[key] = { texture: glTex, refCount: 1 };
    return glTex;
};

SMTool._getOrCreateTex4x = function (context, SP, texDataUrl, pageIdx, img, pma) {
    var key = texDataUrl + '||' + pageIdx;
    var entry = SMTool._texCache[key];
    if (entry) {
        entry.refCount++;
        return entry.texture;
    }
    var glTex = new SP.GLTexture(context, img, pma || false);
    SMTool._texCache[key] = { texture: glTex, refCount: 1 };
    return glTex;
};

// 释放节点持有的纹理引用（节点删除时调用）
SMTool._releaseNodeTextures = function (node) {
    if (!node._texCacheKeys) return;
    for (var i = 0; i < node._texCacheKeys.length; i++) {
        var key = node._texCacheKeys[i];
        var entry = SMTool._texCache[key];
        if (entry) {
            entry.refCount--;
            if (entry.refCount <= 0) {
                try { entry.texture.dispose(); } catch (e) {}
                delete SMTool._texCache[key];
            }
        }
    }
    node._texCacheKeys = [];
};

// ---- 初始化共享 WebGL 渲染器（只创建一次，所有节点共用）----
SMTool._initSharedRenderer = function () {
    if (SMTool._sharedCanvas) return;  // 已初始化

    var canvas = document.createElement('canvas');
    canvas.id = 'sharedSpineCanvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;z-index:3;pointer-events:none';
    document.getElementById('app').appendChild(canvas);

    SMTool._resizeSharedRenderer();

    // stencil: true 是必须的 — Spine 的裁剪(Clipping)和遮罩(Mask)功能依赖模板缓冲区
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });

    if (!gl) {
        console.error('[SharedRenderer] WebGL not available');
        return;
    }

    SMTool._sharedCanvas = canvas;
    SMTool._sharedGL = gl;

    // 混合模式 — 不预设全局 blend，由各 Spine 运行时内部按 slot 控制
    gl.enable(gl.BLEND);
    // 默认 blend 函数仅作为后备，实际渲染由 Spine batcher/shader 逐 slot 覆盖
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    console.log('[SharedRenderer] Initialized — all nodes will share 1 WebGL context');
};

// ---- 调整共享渲染器尺寸 ----
SMTool._resizeSharedRenderer = function () {
    var c = SMTool._sharedCanvas;
    if (c) {
        c.width = window.innerWidth;
        c.height = window.innerHeight;
    }
};

// ---- 视口坐标转换 ----
SMTool.worldToCanvas = function (wx, wy) {
    var z = SMData.view.zoom;
    return {
        x: (wx + SMData.view.x) * z + window.innerWidth / 2,
        y: (wy + SMData.view.y) * z + window.innerHeight / 2
    };
};

SMTool.canvasToWorld = function (sx, sy) {
    var z = SMData.view.zoom;
    return {
        x: (sx - window.innerWidth / 2) / z - SMData.view.x,
        y: (sy - window.innerHeight / 2) / z - SMData.view.y
    };
};

SMTool.worldToDOM = function (wx, wy) {
    return SMTool.worldToCanvas(wx, wy);
};

// ---- WebGL 渲染器设置（使用共享 GL 上下文）----
// imgs: 按 atlas page 索引的 Image 数组
SMTool._setupWebGLRenderer = function (node, SP, WGL, atlas, imgs, useVer) {
    var sk = node.skeleton;
    var physParam = node._physParam;
    var sharedGL = SMTool._sharedGL;

    if (!sharedGL) {
        console.warn('[Spine] Shared GL not ready, retry later for #' + node.id);
        node._needsWebGLRetry = true;
        return;
    }

    // 清理旧资源
    if (node.batcher) { try { node.batcher.dispose(); } catch (e) {} }
    if (node.shader) { try { node.shader.dispose(); } catch (e) {} }
    if (node.sceneRenderer) { try { node.sceneRenderer.dispose(); } catch (e) {} node.sceneRenderer = null; }
    if (node.glTextures) {
        node.glTextures.forEach(function (t) { try { t.dispose(); } catch (e) {} });
    }
    node.glTextures = [];

    // 计算边界
    sk.setToSetupPose();
    sk.updateWorldTransform(physParam);
    var boundsOff = new SP.Vector2();
    var boundsSize = new SP.Vector2();
    try {
        if (typeof sk.getBounds === 'function') {
            sk.getBounds(boundsOff, boundsSize, []);
        } else {
            SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
        }
    } catch (e) {
        console.warn('[Spine] getBounds failed, using fallback:', e.message);
        SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
    }
    node.bounds = { offset: boundsOff, size: boundsSize };

    var pad = Math.max(100, Math.ceil(Math.max(boundsSize.x, boundsSize.y) * 0.4));
    var cw = Math.max(400, Math.ceil(boundsSize.x) + pad * 2);
    var ch = Math.max(400, Math.ceil(boundsSize.y) + pad * 2);
    console.log('[Spine] SharedGL: ' + cw + 'x' + ch + ' for #' + node.id + ', bounds: ' + boundsSize.x.toFixed(0) + 'x' + boundsSize.y.toFixed(0));

    // 更新 DOM 占位区域（用尺寸 div 撑开面板，骨架由共享画布渲染）
    var nodeEl = SMTool._getEl(node.id);
    if (nodeEl) {
        var wrap = nodeEl.querySelector('.spine-canvas-wrap');
        if (wrap) {
            var oldContainer = wrap.querySelector('.spine-canvas-container');
            if (oldContainer) oldContainer.remove();
            var oldC = wrap.querySelector('canvas');
            if (oldC) oldC.remove();

            // 找到原始占位 div，调整为骨架画布尺寸
            var ph = wrap.querySelector('div');
            if (ph) {
                ph.style.width = cw + 'px';
                ph.style.height = ch + 'px';
                ph.style.padding = '0';
                ph.style.display = 'block';
                ph.textContent = '';  // 隐藏"拖入 Spine 文件"
            }
            wrap.style.width = (cw - 8) + 'px';
            wrap.style.height = ch + 'px';
        }
    }

    node._canvasWidth = cw - 4;
    node._canvasHeight = ch;
    // 节点有 border: 2px 左右各 2px，内容宽度 = 总宽 - 4px
    node.width = Math.max(cw, node.width, 260);
    if (nodeEl) nodeEl.style.width = (node.width - 4) + 'px';

    // 居中 Skeleton
    sk.x = cw / 2 - (boundsOff.x + boundsSize.x / 2);
    sk.y = ch / 2 - (boundsOff.y + boundsSize.y / 2);
    sk.updateWorldTransform(physParam);

    // 所有节点共享同一个 gl 引用
    node.gl = sharedGL;
    node.canvas = SMTool._sharedCanvas;
    node._glLost = false;

    // 根据版本设置 WebGL 资源（使用共享上下文）
    try {
        if (useVer === '4.3' || useVer === '4.2') {
            SMTool._setupWebGL4xShared(node, SP, atlas, imgs, cw, ch);
        } else {
            if (!WGL || !WGL.Shader) {
                console.warn('[Spine] WGL not ready for 3.8 node #' + node.id + ', will retry...');
                node._needsWebGLRetry = true;
                return;
            }
            SMTool._setupWebGL38Shared(node, WGL, atlas, imgs, cw, ch);
        }
    } catch (e) {
        console.error('[Spine] Shared WebGL setup failed for #' + node.id + ':', e.message);
        // ★ 保留 sharedGL 引用，标记重试而非永久跳过（node.gl=null 会导致渲染循环永远跳过该节点）
        node._needsWebGLRetry = true;
    }
};

// ---- 4.x 共享 ManagedWebGLRenderingContext（所有 4.x 节点共用一个，避免状态追踪错乱）----
SMTool._sharedManagedContext4x = null;

// ---- 4.x WebGL 设置（共享上下文+纹理缓存+多图集）----
SMTool._setupWebGL4xShared = function (node, SP, atlas, imgs, cw, ch) {
    var canvas = SMTool._sharedCanvas;

    // 所有 4.x 节点共用一个 ManagedWebGLRenderingContext 实例
    // 多个实例包裹同一个 canvas 会导致内部 GL 状态追踪错乱，
    // 进而导致贴图混合模式（Additive等）失效、裁剪区域黑屏等问题
    if (!SMTool._sharedManagedContext4x) {
        SMTool._sharedManagedContext4x = new SP.ManagedWebGLRenderingContext(canvas, { alpha: true });
        console.log('[SharedRenderer] Created single shared ManagedWebGLRenderingContext for all 4.x nodes');
    }
    var context = SMTool._sharedManagedContext4x;
    node._managedContext = context;

    var renderer = new SP.SceneRenderer(canvas, context, true);
    node.sceneRenderer = renderer;

    renderer.camera.position.set(cw / 2, ch / 2, 0);
    renderer.camera.viewportWidth = cw;
    renderer.camera.viewportHeight = ch;
    renderer.camera.update();

    node._texCacheKeys = [];
    var pageDataUrls = node._srcTexDataUrls || [];
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
        var texDataUrl = (pageDataUrls && i < pageDataUrls.length)
            ? pageDataUrls[i].dataUrl
            : (node._srcTexDataUrl || '');
        var glTex = SMTool._getOrCreateTex4x(context, SP, texDataUrl, i, pageImg, page.pma || false);
        page.setTexture(glTex);
        node.glTextures.push(glTex);
        node._texCacheKeys.push(texDataUrl + '||' + i);
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        atlas.regions[j].texture = atlas.regions[j].page.texture;
    }
};

// ---- 3.8 WebGL 设置（共享上下文+纹理缓存+Shader共享+多图集）----
SMTool._setupWebGL38Shared = function (node, WGL, atlas, imgs, cw, ch) {
    var gl = SMTool._sharedGL;

    node.shader = WGL.Shader.newTwoColoredTextured(gl);
    node.batcher = new WGL.PolygonBatcher(gl);
    node.mvp = new WGL.Matrix4();
    node.skeletonRenderer = new WGL.SkeletonRenderer(gl);
    node.mvp.ortho2d(0, 0, cw - 1, ch - 1);

    node._texCacheKeys = [];
    var pageDataUrls = node._srcTexDataUrls || [];
    for (var i = 0; i < atlas.pages.length; i++) {
        var page = atlas.pages[i];
        var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
        var texDataUrl = (pageDataUrls && i < pageDataUrls.length)
            ? pageDataUrls[i].dataUrl
            : (node._srcTexDataUrl || '');
        try {
            var glTex = SMTool._getOrCreateTex38(gl, WGL, texDataUrl, i, pageImg);
            page.texture = glTex;
            node.glTextures.push(glTex);
            node._texCacheKeys.push(texDataUrl + '||' + i);
        } catch (e) {
            console.warn('[Spine] GL texture failed:', e);
        }
    }
    for (var j = 0; j < atlas.regions.length; j++) {
        var region = atlas.regions[j];
        if (region.page && region.page.texture) region.texture = region.page.texture;
    }
};

// ---- 渲染循环（共享 WebGL 上下文 + 视口裁剪）----
SMTool._lt = 0;
SMTool._fc = 0;
SMTool._ft = 0;

SMTool._loop = function (now) {
    requestAnimationFrame(function (t) { SMTool._loop(t); });

    var dt = Math.min((now - SMTool._lt) / 1000, 0.1);
    SMTool._lt = now;
    SMTool._fc++;

    var gl = SMTool._sharedGL;
    if (!gl) return;

    var WGL38 = window.spine38 && window.spine38.webgl;
    var sharedCanvas = SMTool._sharedCanvas;
    var cwFull = sharedCanvas.width;
    var chFull = sharedCanvas.height;

    // ---- 视口裁剪：计算当前可见的世界坐标范围 ----
    var z = SMData.view.zoom;
    var vx = SMData.view.x;
    var vy = SMData.view.y;
    var vpW = cwFull / z;
    var vpH = chFull / z;
    var visLeft   = -vx - vpW / 2;
    var visTop    = -vy - vpH / 2;
    var visRight  = visLeft + vpW;
    var visBottom = visTop + vpH;
    // 冻结区（渲染但不更新动画）：可见区外扩 50 世界单位
    var margin = 50;
    var frzLeft   = visLeft - margin;
    var frzTop    = visTop - margin;
    var frzRight  = visRight + margin;
    var frzBottom = visBottom + margin;

    // ★ 优化：合并统计与渲染为一次遍历
    var doStats = (now - SMTool._ft >= 1000);
    var totalDraws = 0, totalBones = 0;

    // ★ 优化：没有需要渲染的节点时跳过全清操作
    var hasVisibleNode = false;

    // ★ 先遍历检查是否有可见节点，无则跳过整帧 WebGL 操作
    var previewCheckIter = SMData.nodes.values();
    var previewCheck = previewCheckIter.next();
    while (!previewCheck.done) {
        var pcNode = previewCheck.value;
        if (pcNode.state && pcNode.skeleton && pcNode._canvasWidth) {
            hasVisibleNode = true;
            break;
        }
        previewCheck = previewCheckIter.next();
    }

    if (!hasVisibleNode) {
        // 无任何可渲染节点 → 仅更新 2D 画布，跳过 WebGL 清屏
        if (doStats) {
            document.getElementById('sbFPS').textContent = 'FPS: --';
            document.getElementById('sbBones').textContent = '骨骼: 0';
            document.getElementById('sbDraws').textContent = 'Draw call: 0';
            SMTool._fc = 0; SMTool._ft = now;
        }
        SMTool._renderSnapLines();
        if ((SMTool._fc & 3) === 0) SMTool._renderMinimap();
        return;
    }
    hasVisibleNode = false; // 重置，后续真正遍历时再标记

    // 每帧全清画布（仅当有节点需要渲染时）
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, cwFull, chFull);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // ★ 优化：帧级 GL 混合状态初始化（仅一次，不再逐节点重复）
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // ★ 优化：缓存 ManagedWebGLRenderingContext 能力检测（仅首次）
    if (SMTool._mcBlendFuncCap === undefined) {
        var mcCheck = SMTool._sharedManagedContext4x;
        if (mcCheck) {
            SMTool._mcBlendFuncCap = (typeof mcCheck.blendFunc === 'function');
            SMTool._mcBlendSrcProp = (mcCheck._blendSrc !== undefined) ? '_blendSrc' : ((mcCheck._cachedBlendSrc !== undefined) ? '_cachedBlendSrc' : null);
            SMTool._mcBlendDstProp = SMTool._mcBlendSrcProp ? SMTool._mcBlendSrcProp.replace('Src', 'Dst') : null;
        } else {
            SMTool._mcBlendFuncCap = false;
            SMTool._mcBlendSrcProp = null;
            SMTool._mcBlendDstProp = null;
        }
    }

    gl.enable(gl.SCISSOR_TEST);

    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var node = result.value;

        // ★ 快速跳过：无渲染数据的节点
        if (!node.state || !node.skeleton || !node._canvasWidth) {
            result = nodesIter.next(); continue;
        }

        if (node._needsWebGLRetry) {
            var WGLnow = window.spine38 && window.spine38.webgl;
            if (WGLnow && WGLnow.Shader && node.atlasData && (node.textureImg || (node._texImgs && node._texImgs.length > 0))) {
                try {
                    var retryImgs = (node._texImgs && node._texImgs.length > 0) ? node._texImgs : [node.textureImg];
                    SMTool._setupWebGL38Shared(node, WGLnow, node.atlasData, retryImgs, node._canvasWidth, node._canvasHeight);
                    node._needsWebGLRetry = false;
                } catch (e2) {}
            }
            if (node._needsWebGLRetry) { result = nodesIter.next(); continue; }
        }

        if (!node.gl) { result = nodesIter.next(); continue; }

        var nodeW = node._debugCanvasW || node._canvasWidth;
        var nodeH = node._debugCanvasH || node._canvasHeight;
        var nodeScale = (node._customScale !== undefined ? node._customScale : 1.0);
        var scaledW = nodeW * nodeScale;
        var scaledH = nodeH * nodeScale;

        // ★ 优化：统计骨骼/Draw（合并到主循环，避免二次遍历）
        if (doStats && node.skeleton) {
            totalBones += node.bones.length;
            totalDraws += (node.skeleton.drawOrder ? node.skeleton.drawOrder.length : 0);
        }

        if (node.x + scaledW < frzLeft || node.x > frzRight ||
            node.y + scaledH < frzTop || node.y > frzBottom) {
            node._visible = false; result = nodesIter.next(); continue;
        }
        node._visible = true;
        hasVisibleNode = true;

        var sp = SMTool.worldToCanvas(node.x, node.y);
        var sx = Math.round(sp.x), sy = Math.round(sp.y);
        var sw = Math.round(nodeW * z * nodeScale), sh = Math.round(nodeH * z * nodeScale);

        // 跳过 header 区域，scissor 从 canvas-wrap 位置开始
        if (!node._headerH || node._headerH <= 0) {
            var el = SMTool._getEl(node.id);
            var hdr = el ? el.querySelector('.header') : null;
            var measured = hdr ? hdr.offsetHeight : 0;
            node._headerH = measured > 0 ? measured : 70;
        }
        var headerOffset = Math.round(node._headerH * z * nodeScale);
        sy += headerOffset;

        if (sw < 4 || sh < 4) { result = nodesIter.next(); continue; }

        // 🔒 [LOCK-5] 渲染循环看门狗：仅修复 timeScale=0 残留冻结
        // 触发条件：面板未展开 且 流未播放（正常模式下的异常残留修复）
        // 规则：只解冻 timeScale，不做 _applyTracksToState（避免重置正常动画）
        if (node.state && node.skeletonData && !SMData._flowPanel.expanded && !SMData._fullPlayback.isPlaying) {
            try {
                for (var wdi = 0; wdi < 5; wdi++) {
                    var wdEntry = node.state.getCurrent(wdi);
                    if (wdEntry && wdEntry.timeScale === 0) {
                        wdEntry.timeScale = 1.0;
                    }
                }
            } catch (e) {}
        }

        // 动画更新：动态模式始终 60fps，性能模式 <20% 冻结，静态模式仅选中节点播放
        // ★ 层级预览中正在播放的节点忽略缩放限制，始终同步播放动画
        var isFlowPlaying = SMData._fullPlayback && SMData._fullPlayback.isPlaying;
        var isPlayingNode = isFlowPlaying && SMData._fullPlayback.activePathIdx >= 0 &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep] &&
            SMData._fullPaths[SMData._fullPlayback.activePathIdx].nodes[SMData._fullPlayback.currentStep].id === node.id;
        var isSelectedNode = SMData.selectedNodes.has(node.id);
        var isLayerActive = SMData._layerPlayingNodes && SMData._layerPlayingNodes.has(node.id);
        var isInLayerChain = SMData._layerAllChainNodes && SMData._layerAllChainNodes.has(node.id);
        var shouldAnimate = false;
        if (SMData.renderMode === 'static') {
            shouldAnimate = isSelectedNode || isPlayingNode || isLayerActive;
        } else {
            shouldAnimate = (SMData.renderMode === 'dyn' || z >= 0.20 || isPlayingNode || isLayerActive);
        }
        // ★ 层级预览播放中：链内非活跃节点强制冻结，不受渲染模式/缩放影响
        if (isInLayerChain && !isLayerActive) {
            shouldAnimate = false;
        }

        // ★★ 始终更新时间轴（轻量操作，不做骨骼变换），确保事件帧检测不受渲染模式限制
        var spd = (typeof node._playbackSpeed === 'number' && node._playbackSpeed !== 1.0) ? node._playbackSpeed : 1.0;
        node.state.update(dt * spd);

        // ★ 轨道动画模式：双向 alpha 淡入淡出状态机
        //    baseTrack alpha 1→0，overlayTrack alpha 0→1（mixBlend='replace'）
        //    仅在有 mixOut>0 过渡时激活 _cfState
        if (node._trackMode && node._cfState) {
            var cf = node._cfState;
            var cfIs4x = (node._spineVer === '4.3' || node._spineVer === '4.2');

            if (cf.phase === 'waiting') {
                var baseEntry = node.state.getCurrent(cf.baseTrack);
                if (baseEntry) {
                    var animDur = (baseEntry.animation || baseEntry._animation).duration;
                    if (animDur > 0) {
                        var remaining = Math.max(0, animDur - baseEntry.trackTime);
                        if (remaining <= cf.mixOut + 0.001) {
                            var seq = node._trackSequence[cf.ti];
                            var nextAnim = seq.animations[cf.nextAnimIdx];
                            var ovEntry = node.state.setAnimation(cf.overlayTrack, nextAnim.name, false);
                            if (ovEntry) {
                                ovEntry.alpha = 0;
                                ovEntry.mixBlend = SMTool._mixBlendValue('replace');
                                ovEntry.mixDuration = 0;
                                cf.phase = 'crossfading';
                                cf.elapsed = 0;
                                // ★ 新动画已设到 overlayTrack，强制本帧应用骨骼姿态
                                node._dirty = true;
                            }
                        }
                    }
                }
            } else if (cf.phase === 'crossfading') {
                cf.elapsed += dt * spd;
                var progress = Math.min(1, cf.elapsed / Math.max(cf.mixOut, 0.001));
                var baseE = node.state.getCurrent(cf.baseTrack);
                var ovE = node.state.getCurrent(cf.overlayTrack);
                if (baseE) baseE.alpha = Math.max(0, (1 - progress) * cf.seqAlpha);
                if (ovE) ovE.alpha = progress * cf.seqAlpha;

                if (progress >= 1) {
                    // 淡入完成：交接给 baseTrack
                    var seq2 = node._trackSequence[cf.ti];
                    var nextAnim2 = seq2.animations[cf.nextAnimIdx];
                    node.state.clearTrack(cf.baseTrack);
                    var newEntry = node.state.setAnimation(cf.baseTrack, nextAnim2.name, false);
                    if (newEntry) {
                        newEntry.alpha = cf.seqAlpha;
                        if (cfIs4x && cf.seqMixBlend) newEntry.mixBlend = SMTool._mixBlendValue(cf.seqMixBlend);
                        newEntry.mixDuration = 0;
                    }
                    node.state.clearTrack(cf.overlayTrack);
                    // ★ 清空状态，防止下一帧重复触发
                    node._cfState = null;
                    // ★ 手动序列模式：索引前进到下一个动画
                    if (!node._seqIdx) node._seqIdx = {};
                    var nxt = cf.nextAnimIdx + 1;
                    if (nxt >= seq2.animations.length) nxt = (cf.loopSeq !== false) ? 0 : seq2.animations.length - 1;
                    node._seqIdx[cf.ti] = nxt;
                    node._dirty = true;
                }
            }
        }

        // ★ 轨道动画模式：手动序列索引跟踪 + 循环重启
        //    不再依赖 Spine 的 addAnimation 队列（跨版本行为不一致）。
        //    改为：setAnimation 只设当前动画 → 检测 isComplete() → 切到下一个索引。
        if (node._trackMode && node._trackSequence) {
            // 初始化序列索引存储
            if (!node._seqIdx) node._seqIdx = {};
            
            for (var si = 0; si < node._trackSequence.length; si++) {
                var rSeq = node._trackSequence[si];
                if (!rSeq.enabled) { delete node._seqIdx[si]; continue; }
                if (rSeq.loopSeq === false) { delete node._seqIdx[si]; continue; }
                if (node._cfState && node._cfState.ti === si) continue;
                
                var rBTrack = si * 2;
                var rOTrack = si * 2 + 1;
                var rAnims = rSeq.animations;
                if (!rAnims || rAnims.length === 0) continue;
                
                // 确保索引在有效范围内
                if (node._seqIdx[si] === undefined || node._seqIdx[si] >= rAnims.length) {
                    node._seqIdx[si] = 0;
                }
                
                // 如果当前轨道为空（还没开始或已被清空），启动第一个动画
                var bEntry = node.state.getCurrent(rBTrack);
                var oEntry = node.state.getCurrent(rOTrack);
                var isIdle = true;
                
                if (bEntry) {
                    try {
                        if (typeof bEntry.isComplete === 'function') isIdle = bEntry.isComplete();
                        else if (bEntry.isComplete !== undefined) isIdle = !!bEntry.isComplete;
                    } catch (e) {}
                }
                if (oEntry) {
                    var oIdle = true;
                    try {
                        if (typeof oEntry.isComplete === 'function') oIdle = oEntry.isComplete();
                        else if (oEntry.isComplete !== undefined) oIdle = !!oEntry.isComplete;
                    } catch (e) {}
                    isIdle = isIdle && oIdle;
                }
                
                if (isIdle) {
                    // ★ 当前动画播完 → 切换到下一个索引
                    var nextIdx = node._seqIdx[si];
                    var selAnim = rAnims[nextIdx];
                    
                    var rstEntry = node.state.setAnimation(rBTrack, selAnim.name, false);
                    if (rstEntry) {
                        rstEntry.alpha = (rSeq.alpha !== undefined) ? rSeq.alpha : 1.0;
                        if ((node._spineVer === '4.3' || node._spineVer === '4.2') && rSeq.mixBlend) {
                            rstEntry.mixBlend = SMTool._mixBlendValue(rSeq.mixBlend);
                        }
                        rstEntry.mixDuration = 0;
                        
                        // ★ 索引前进，到头则回到 0
                        node._seqIdx[si] = (nextIdx + 1) % rAnims.length;
                        
                        // ★ 处理 mixOut：如果有混合时间，启动 crossfade
                        if (selAnim.mixOut > 0) {
                            var nextSeqIdx = node._seqIdx[si]; // 已经 advance 过了，这是下一个动画的索引
                            // 下一个动画的 mixOut 是当前动画的 mixOut
                            // 实际上，selAnim.mixOut 是当前动画到下一个的过渡时间
                            // 设置 crossfade 状态让渲染循环处理混合
                            if (!node._cfState) {
                                node._cfState = {
                                    ti: si, baseTrack: rBTrack, overlayTrack: rOTrack,
                                    animIdx: nextIdx, nextAnimIdx: node._seqIdx[si],
                                    mixOut: selAnim.mixOut, elapsed: 0,
                                    phase: 'waiting',
                                    seqAlpha: rSeq.alpha,
                                    seqMixBlend: rSeq.mixBlend || 'replace',
                                    loopSeq: rSeq.loopSeq !== false
                                };
                            }
                        }
                        
                        node._dirty = true;
                    }
                }
            }
        }

        // ★ 事件帧气泡：始终检测飘动（不受 renderMode / 选中状态影响）
        //    显隐仅由左上角「💬 特效」按钮控制（CSS #app.hide-bubbles .event-bubble）
        SMTool._ensureEventFrames(node);
        if (node._eventFrames && node._eventFrames.length > 0) {
            var trackEntry = node.state.getCurrent(0);
            if (trackEntry) {
                var anim = trackEntry.animation || trackEntry._animation;
                var evDuration = anim ? anim.duration : 1;
                // trackTime 跨循环累加，取模得到当前循环内的时间
                var rawTime = trackEntry.trackTime;
                var curTime = rawTime % Math.max(evDuration, 0.001);
                var prevTime = node._lastEventCheckTime || 0;
                // 检测循环：当前本地时间 < 上次 说明动画已重新开始
                if (curTime < prevTime - 0.001) prevTime = 0;
                for (var efi = 0; efi < node._eventFrames.length; efi++) {
                    var ef = node._eventFrames[efi];
                    if (ef.time >= prevTime && ef.time <= curTime) {
                        SMTool._showEventBubble(node, ef);
                    }
                }
                node._lastEventCheckTime = curTime;
            }
        }

        if (shouldAnimate || node._dirty) {
            // ★ 仅对动画节点应用骨骼变换（时间更新已在上方完成）
            //    _dirty=true 时即使静态模式/未选中也强制应用，确保轨道参数修改后即时更新画面
            node.state.apply(node.skeleton);
            if (node._dirty) node._dirty = false;
        }
        node.skeleton.updateWorldTransform(node._physParam);

        // ★ 防御：修复 skeleton 根位置 NaN（空默认皮肤的 spine 文件可能出现）
        if (isNaN(node.skeleton.x)) node.skeleton.x = 0;
        if (isNaN(node.skeleton.y)) node.skeleton.y = 0;
        if (isNaN(node.skeleton.scaleX)) node.skeleton.scaleX = 1;
        if (isNaN(node.skeleton.scaleY)) node.skeleton.scaleY = 1;

        // ★ 调试偏移：在自然位置上叠加用户拖拽的位移
        if (node._debugOffsetX || node._debugOffsetY) {
            if (node._baseSkX === undefined) { node._baseSkX = node.skeleton.x; node._baseSkY = node.skeleton.y; }
            node.skeleton.x = (node._baseSkX || 0) + (node._debugOffsetX || 0);
            node.skeleton.y = (node._baseSkY || 0) + (node._debugOffsetY || 0);
            node.skeleton.updateWorldTransform(node._physParam);
        }

        var glY = chFull - sy - sh;
        gl.scissor(sx, glY, sw, sh);
        gl.viewport(sx, glY, sw, sh);
        gl.clearColor(0, 0, 0, 0);
        gl.clearStencil(0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

        // ★ 优化：同步 batcher 内部混合状态（帧级已重置 GL，此处仅同步缓存）
        if (node.batcher) {
            node.batcher.srcBlend = gl.ONE;
            node.batcher.dstBlend = gl.ONE_MINUS_SRC_ALPHA;
        }

        // ★ 优化：同步 ManagedWebGLRenderingContext（使用缓存的能力检测）
        var mcSync = SMTool._sharedManagedContext4x;
        if (mcSync && SMTool._mcBlendFuncCap) {
            mcSync.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else if (mcSync && SMTool._mcBlendSrcProp) {
            mcSync[SMTool._mcBlendSrcProp] = gl.ONE;
            mcSync[SMTool._mcBlendDstProp] = gl.ONE_MINUS_SRC_ALPHA;
        }

        if ((node._spineVer === '4.3' || node._spineVer === '4.2') && node.sceneRenderer && node.sceneRenderer.begin) {
            node.sceneRenderer.camera.position.set(nodeW / 2, nodeH / 2, 0);
            node.sceneRenderer.camera.viewportWidth = nodeW;
            node.sceneRenderer.camera.viewportHeight = nodeH;
            node.sceneRenderer.camera.update();
            node.sceneRenderer.begin();
            // SceneRenderer.begin() 可能重置 viewport/scissor，重新应用节点专属裁剪区域
            gl.viewport(sx, glY, sw, sh);
            gl.scissor(sx, glY, sw, sh);
            // ★ 传递节点的 PMA 设置（4.x drawSkeleton 第2参数）
            node.sceneRenderer.drawSkeleton(node.skeleton, node.premultipliedAlpha);
            node.sceneRenderer.end();
            // ★ 4.x 路径：自定义插槽图片渲染在骨架之后（SceneRenderer 不支持分段交错）
            if (!SMData._hideBoneImgs) {
                SMTool._renderNodeSlotImages(node, gl, nodeW, nodeH, sx, glY, sw, sh);
            }
        } else if (node.shader && node.batcher && node.skeletonRenderer && WGL38) {
            node.mvp.ortho2d(0, 0, nodeW - 1, nodeH - 1);
            // ★ 3.8 路径：按 drawOrder 精确分段交错渲染（自定义图片在正确层级）
            SMTool._renderSpine38Interleaved(node, gl, WGL38, nodeW, nodeH, sx, glY, sw, sh);
        }

        // ★ 渲染骨骼挂图（可被左上角"挂点"按钮隐藏）
        if (!SMData._hideBoneImgs) {
            SMTool._renderNodeBoneImages(node, gl, nodeW, nodeH, sx, glY, sw, sh);
        }

        result = nodesIter.next();
    }

    gl.disable(gl.SCISSOR_TEST);

    // ★ 优化：统计（合并到主循环，无需二次遍历）
    if (doStats) {
        document.getElementById('sbFPS').textContent = 'FPS: ' + Math.round(SMTool._fc * 1000 / (now - SMTool._ft));
        if (performance.memory) {
            var mb = (performance.memory.totalJSHeapSize / 1048576).toFixed(1);
            document.getElementById('sbMemory').textContent = '内存: ' + mb + 'MB';
        }
        document.getElementById('sbBones').textContent = '骨骼: ' + totalBones;
        document.getElementById('sbDraws').textContent = 'Draw call: ' + totalDraws;
        SMTool._fc = 0;
        SMTool._ft = now;
    }

    // ★ 优化：2D Canvas 脏标记 — 仅在视图/连线变化时重绘网格和连线
    // 但以下情况必须每帧重绘：框选拖拽中、连线拖拽中、控制点拖拽中、标签拖拽中
    var viewChanged = (SMData.view.zoom !== SMData._lastViewZoom ||
        SMData.view.x !== SMData._lastViewX || SMData.view.y !== SMData._lastViewY);
    var connChanged = (SMData.connections.length !== SMData._lastConnCount) || viewChanged;
    var selChanged = (SMData.selectedConnection !== SMData._lastSelConn) || (SMData.selectedNodes.size !== SMData._lastSelCount);
    var needsRedraw = viewChanged || connChanged || selChanged || SMData._forceRedraw ||
        SMData.marqueeActive || SMData.connecting || SMData.draggingCP || SMData.draggingLabel ||
        SMData.isPanning || SMData.draggedNode || SMData.isMultiDragging;

    if (needsRedraw) {
        SMData._lastViewZoom = SMData.view.zoom;
        SMData._lastViewX = SMData.view.x;
        SMData._lastViewY = SMData.view.y;
        SMData._lastConnCount = SMData.connections.length;
        SMData._lastSelConn = SMData.selectedConnection;
        SMData._lastSelCount = SMData.selectedNodes.size;
        SMData._forceRedraw = false;

        // ★ 防御：连线渲染依赖 getBoundingClientRect() 读取 DOM 端点位置。
        // 若 _updateAllPos 还在 rAF 队列中未执行（缩放/平移触发的延迟更新），
        // 则 DOM 位置是旧的，而 view.zoom/x/y 已更新，canvasToWorld 换算会错位。
        // 此处强制同步刷新 DOM，确保连线端点坐标与 WebGL 画面一致。
        if (viewChanged && SMTool._allPosScheduled) {
            SMTool._allPosScheduled = false;
            SMTool._allPosQueued = false;
            SMTool._updateAllPosCore();
        }

        SMTool._renderGrid();
        SMTool._renderGroupBoxes(SMTool.gridCtx);
        SMTool._renderConnections();
    }
    SMTool._renderSnapLines();
    // ★ 优化：鸟瞰图每 4 帧渲染一次（约 15fps），减少 2D canvas 开销
    if ((SMTool._fc & 3) === 0) SMTool._renderMinimap();
    SMTool._renderAnimPreview(now);
};

// ---- 缩放 ----
SMTool._onWheel = function (e) {
    var oz = SMData.view.zoom;
    var factor = e.deltaY > 0 ? 0.935 : 1.065;
    SMData.view.zoom = Math.max(0.03, Math.min(5, SMData.view.zoom * factor));
    var mx = e.clientX - window.innerWidth / 2;
    var my = e.clientY - window.innerHeight / 2;
    SMData.view.x += mx * (1 / SMData.view.zoom - 1 / oz);
    SMData.view.y += my * (1 / SMData.view.zoom - 1 / oz);
    // ★ forceSync=true：缩放时必须同步更新 DOM 位置，
    // 否则下一帧 _renderConnections 用新 zoom 读旧 DOM 位置会算出错误坐标
    SMTool._updateAllPos(true);
    SMTool._syncZoomUI();
};

SMTool._onZoomSlider = function (e) {
    var pct = parseInt(e.target.value) / 100;
    var oz = SMData.view.zoom;
    SMData.view.zoom = pct;
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    SMData.view.x += cx * (1 / SMData.view.zoom - 1 / oz);
    SMData.view.y += cy * (1 / SMData.view.zoom - 1 / oz);
    // ★ forceSync=true：缩放滑块同样需要同步更新 DOM
    SMTool._updateAllPos(true);
    SMTool._syncZoomUI();
};

// ================================================================
// ★ 右上角动画预览浮窗面板 — 独立 WebGL 渲染
// ================================================================

// ---- 初始化预览骨架 ----
// 从源节点复用源数据，创建独立的 WebGL canvas + 上下文 + Spine 骨架
SMTool._initAnimPreview = function (node) {
    var pp = SMData._animPreview;
    if (!node || !node._srcAtlasText || !(node._srcSkelJson || node._srcSkelBinBase64)) return;

    // 先销毁旧预览
    SMTool._destroyAnimPreview();

    // ================================================================
    // 🔒🔒🔒 [LOCK-B] 阻止渲染循环在 setup 完成前绘制
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // 若此旗标不设，render 可能抓到 setup 中间态（skeleton 已赋值但 state 未配置），
    // 导致短暂显示 T-pose / setup pose 等错误画面。
    // ================================================================
    pp._readyToRender = false;

    var panel = document.getElementById('animPreviewPanel');
    var canvas = document.getElementById('appCanvas');
    if (!panel || !canvas) return;

    // 查找匹配的动画名
    // 优先从 node.animations 查找，回退到 skeletonData.animations
    var allAnims = (node.animations && node.animations.length > 0)
        ? node.animations
        : (node.skeletonData && node.skeletonData.animations
            ? node.skeletonData.animations.map(function(a) { return { name: a.name, duration: a.duration || 0 }; })
            : []);
    var targetAnim = node.currentAnim;
    if (!targetAnim || targetAnim.length === 0) {
        if (allAnims.length > 0) {
            targetAnim = allAnims[0].name;
        } else {
            return; // 无可用动画，跳过
        }
    }

    // 验证动画名在动画列表中
    var animFound = false;
    for (var ai = 0; ai < allAnims.length; ai++) {
        if (allAnims[ai].name === targetAnim) { animFound = true; break; }
    }
    if (!animFound) return; // 动画名不匹配，跳过

    var ver = node.version || node._spineVer || '';
    var useVer = SMTool._resolveRuntimeVersion(ver, null, false);
    var SP = SMTool._getSpineRuntime(useVer);
    var WGL = useVer === '3.8' ? (window.spine38 && window.spine38.webgl) : null;

    if (!SP) return;

    pp._spineVer = useVer;
    var physParam = (useVer !== '3.8' && SP.Physics) ? SP.Physics.update : undefined;

    // 设置面板尺寸和画布（保留用户缩放后的尺寸，首次默认 280×420）
    var savedW = pp.panelW || 385;
    var savedH = pp.panelH || 645;
    panel.style.width = savedW + 'px';
    panel.style.height = savedH + 'px';
    // ★ 等 DOM 布局完成后，取 canvas 实际容器尺寸（排除标题栏），避免拉伸
    var wrap = canvas.parentElement;
    var actualW = wrap ? wrap.clientWidth : savedW;
    var actualH = wrap ? wrap.clientHeight : savedH;
    if (actualW < 10) actualW = savedW;
    if (actualH < 10) actualH = savedH;
    canvas.width = actualW;
    canvas.height = actualH;
    pp.canvas = canvas;
    pp.panelW = savedW;
    pp.panelH = savedH;

    // 获取画布 WebGL 上下文
    var gl = canvas.getContext('webgl2', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true }) ||
              canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false, stencil: true });

    if (!gl) {
        console.warn('[AnimPreview] WebGL not available for preview canvas');
        return;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    pp.gl = gl;

    // 解析 atlas
    var atlasText = node._srcAtlasText;
    var pageDataUrls = (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)
        ? node._srcTexDataUrls
        : [{ name: 'texture', dataUrl: node._srcTexDataUrl }];

    // ================================================================
    // 🔒🔒🔒 [LOCK-2] 预览贴图校验 dataUrl
    // ⚠️ 解锁策略：除非用户明确说「解锁 LOCK-2」，或我主动问询
    //    「是否解锁 LOCK-2 以修改XX功能」且用户同意，否则绝不改动此块。
    //
    // 不能仅凭 _texImgs[pi] 存在就复用，必须比对 dataUrl 一致。
    // 否则切换不同文件时 B 预览会错拿 A 贴图。
    // ================================================================
    var imgs = [];
    var needLoad = false;
    for (var pi = 0; pi < pageDataUrls.length; pi++) {
        var existingImg = null;
        var targetUrl = pageDataUrls[pi].dataUrl;
        // 必须校验同 dataUrl，防止跨文件错拿贴图
        var nodesIter2 = SMData.nodes.values();
        var r2 = nodesIter2.next();
        while (!r2.done) {
            var nd = r2.value;
            var ndUrls = nd._srcTexDataUrls;
            var ndUrl = (ndUrls && ndUrls[pi]) ? ndUrls[pi].dataUrl : (pi === 0 ? nd._srcTexDataUrl : '');
            if (ndUrl === targetUrl && nd._texImgs && nd._texImgs[pi]) {
                existingImg = nd._texImgs[pi];
                break;
            }
            if (ndUrl === targetUrl && nd.textureImg && pi === 0) {
                existingImg = nd.textureImg;
                break;
            }
            r2 = nodesIter2.next();
        }
        if (existingImg) {
            imgs[pi] = existingImg;
        } else {
            needLoad = true;
            var img = new Image();
            img.src = targetUrl;
            imgs[pi] = img;
        }
    }
    // 🔒 [LOCK-2] END

    function doSetup() {
        try {
            var atlas;
            if (useVer === '4.3' || useVer === '4.2') {
                atlas = new SP.TextureAtlas(atlasText);
            } else {
                var firstImg2 = imgs[0];
                atlas = new SP.TextureAtlas(atlasText, function (pagePath) {
                    var pathStr = (typeof pagePath === 'string') ? pagePath : (pagePath && pagePath.name ? pagePath.name : '');
                    var pageFileName = pathStr.replace(/\\/g, '/').split('/').pop().toLowerCase();
                    var matchImg = firstImg2;
                    if (pageDataUrls && imgs) {
                        for (var pdi = 0; pdi < pageDataUrls.length; pdi++) {
                            if (pageDataUrls[pdi].name.toLowerCase() === pageFileName && imgs[pdi]) {
                                matchImg = imgs[pdi];
                                break;
                            }
                        }
                    }
                    return new SP.FakeTexture(matchImg);
                });
            }
            pp._atlasData = atlas;
            pp._texImgs = imgs;

            // ★ 兼容层：应用 atlas 补丁（空格模糊匹配 + 缺失区域容错）
            SMTool._patchAtlasForLoading(atlas);

            var al = SMTool._createLenientAttachmentLoader(atlas, SP);
            var sd;
            var srcType = node._srcType || 'json';
            if (srcType === 'skel' && node._srcSkelBinBase64) {
                var skelBin = SMTool._base64ToUint8(node._srcSkelBinBase64);
                var bl = new SP.SkeletonBinary(al); bl.scale = 1;
                sd = bl.readSkeletonData(skelBin);
            } else {
                if (!node._srcSkelJson) return;
                var jl = new SP.SkeletonJson(al); jl.scale = 1;
                sd = jl.readSkeletonData(node._srcSkelJson);
            }
            pp._skeletonData = sd;

            var sk = new SP.Skeleton(sd);
            // ★ 优先使用源节点当前皮肤，回退到默认皮肤
            var previewSkin = null;
            var skinName = node.currentSkin;
            if (skinName) {
                for (var ski = 0; ski < sd.skins.length; ski++) {
                    if (sd.skins[ski].name === skinName) { previewSkin = sd.skins[ski]; break; }
                }
            }
            if (previewSkin) {
                sk.setSkin(previewSkin);
            } else if (sd.defaultSkin) {
                sk.setSkin(sd.defaultSkin);
            }
            sk.setToSetupPose();
            sk.updateWorldTransform(physParam);
            pp.skeleton = sk;
            pp._physParam = physParam;

            // 计算边界和画布适配
            var boundsOff = new SP.Vector2();
            var boundsSize = new SP.Vector2();
            try {
                if (typeof sk.getBounds === 'function') {
                    sk.getBounds(boundsOff, boundsSize, []);
                } else {
                    SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
                }
            } catch (e) {
                SMTool._computeBoundsManually(sk, boundsOff, boundsSize);
            }

            var cw = canvas.width, ch = canvas.height;
            pp._canvasWidth = cw;
            pp._canvasHeight = ch;
            // ★ 保存参考尺寸和边界信息供 resize 缩放/居中
            pp._refCw = cw;
            pp._refCh = ch;
            pp._boundsOffset = { x: boundsOff.x, y: boundsOff.y };
            pp._boundsSize = { x: boundsSize.x, y: boundsSize.y };
            // ★ 保留已有的内容缩放（不同源文件重建时继承用户缩放级别）
            pp._contentZoom = pp._contentZoom || 1.0;
            var zoom = pp._contentZoom;
            sk.x = cw / 2 - (boundsOff.x + boundsSize.x / 2);
            sk.y = ch / 2 - (boundsOff.y + boundsSize.y / 2);

            // 设置 WebGL 资源
            pp._texCacheKeys = [];
            if (useVer === '4.3' || useVer === '4.2') {
                var context = new SP.ManagedWebGLRenderingContext(canvas, { alpha: true });
                var renderer = new SP.SceneRenderer(canvas, context, true);
                pp._sceneRenderer = renderer;
                pp._batcher = null;
                pp._shader = null;

                renderer.camera.position.set(cw / 2, ch / 2, 0);
                renderer.camera.viewportWidth = cw / zoom;
                renderer.camera.viewportHeight = ch / zoom;
                renderer.camera.update();

                for (var i = 0; i < atlas.pages.length; i++) {
                    var page = atlas.pages[i];
                    var pageImg = (imgs && i < imgs.length) ? imgs[i] : (imgs && imgs[0]) || null;
                    // ★ 预览独立 GL 上下文，不能共享主画布的纹理缓存，直接创建
                    var glTex = new SP.GLTexture(context, pageImg, page.pma || false);
                    page.setTexture(glTex);
                    pp._glTextures.push(glTex);
                }
            } else {
                if (!WGL || !WGL.Shader) return;
                pp._shader = WGL.Shader.newTwoColoredTextured(gl);
                pp._batcher = new WGL.PolygonBatcher(gl);
                pp._mvp = new WGL.Matrix4();
                pp._skeletonRenderer = new WGL.SkeletonRenderer(gl);
                pp._mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);

                for (var j = 0; j < atlas.pages.length; j++) {
                    var page2 = atlas.pages[j];
                    var pageImg2 = (imgs && j < imgs.length) ? imgs[j] : (imgs && imgs[0]) || null;
                    try {
                        // ★ 预览独立 GL 上下文，不能共享主画布的纹理缓存，直接创建
                        var glTex2 = new WGL.GLTexture(gl, pageImg2, false);
                        page2.texture = glTex2;
                        pp._glTextures.push(glTex2);
                    } catch (e2) {
                        console.warn('[AnimPreview] GL texture failed:', e2);
                    }
                }
            }
            // ★ 检测并保存预乘 Alpha 标志
            var pma = false;
            if (atlas.pages && atlas.pages.length > 0 && atlas.pages[0].pma) pma = true;
            pp._premultipliedAlpha = pma;

            // 同步 atlas regions 纹理引用
            for (var k = 0; k < atlas.regions.length; k++) {
                var region = atlas.regions[k];
                if (region.page && region.page.texture) region.texture = region.page.texture;
            }

            // ================================================================
            // 🔒🔒🔒 [LOCK-C] pp.state 必须在 _applyPreviewTracks 之后赋值
            // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
            //    如需修改，一定要寻求同意"解锁"才可以。
            //
            // 若先赋值 pp.state 再调 _applyPreviewTracks，渲染循环可能在中间帧
            // 抓到空的 AnimationState（0 条轨道），apply 后骨架跳回 setup pose。
            // ================================================================
            var stateData = new SP.AnimationStateData(sd);
            var state = new SP.AnimationState(stateData);
            // 复制源节点的全部轨道配置（不只是 track 0）
            SMTool._applyPreviewTracks(pp, state, stateData, sd, node);
            // ★ 先配置好动画再设置 pp.state，避免空状态帧闪烁
            pp.state = state;
            // 🔒 [LOCK-C] END

            state.update(0);
            state.apply(sk);
            // ★ 防御 NaN
            if (isNaN(sk.x)) sk.x = 0;
            if (isNaN(sk.y)) sk.y = 0;
            sk.updateWorldTransform(physParam);
            // ★ 动画后重新计算边界居中（仅空默认皮肤文件，setup pose 无边）
            var setupBoundsValid = pp._boundsOffset && pp._boundsSize &&
                isFinite(pp._boundsOffset.x) && isFinite(pp._boundsSize.x) && pp._boundsSize.x > 0;
            if (!setupBoundsValid) {
                var animOff2 = new SP.Vector2();
                var animSize2 = new SP.Vector2();
                try {
                    // 尝试多个时间点（有些动画首帧不在 t=0）
                    var tryTimes2 = [0];
                    var entry2 = state.getCurrent(0);
                    if (entry2) {
                        var dur2 = (entry2.animation && entry2.animation.duration) || (entry2._animation && entry2._animation.duration) || 1;
                        tryTimes2.push(dur2 * 0.5, dur2 * 0.25);
                    }
                    var foundBounds2 = false;
                    for (var t2 = 0; t2 < tryTimes2.length; t2++) {
                        if (entry2) { entry2.trackTime = tryTimes2[t2]; }
                        state.apply(sk);
                        sk.updateWorldTransform(physParam);
                        if (typeof sk.getBounds === 'function') {
                            sk.getBounds(animOff2, animSize2, []);
                        } else {
                            SMTool._computeBoundsManually(sk, animOff2, animSize2);
                        }
                        if (isFinite(animOff2.x) && isFinite(animSize2.x) && animSize2.x > 0) {
                            foundBounds2 = true;
                            break;
                        }
                    }
                    // 重置回时间 0
                    if (entry2) { entry2.trackTime = 0; }
                    state.apply(sk);
                    if (foundBounds2) {
                        sk.x = cw / 2 - (animOff2.x + animSize2.x / 2);
                        sk.y = ch / 2 - (animOff2.y + animSize2.y / 2);
                        pp._boundsOffset = { x: animOff2.x, y: animOff2.y };
                        pp._boundsSize = { x: animSize2.x, y: animSize2.y };
                    } else {
                        sk.x = 0; sk.y = 0;
                    }
                } catch (e2) {}
                sk.updateWorldTransform(physParam);
            }

            pp.nodeId = node.id;
            pp._lastTime = performance.now();

            // ★ 同步源节点的 PMA 和皮肤设置
            SMTool._syncPreviewPmaAndSkin(pp, node);

            // ================================================================
            // 🔒🔒🔒 [LOCK-D] 就绪旗标 + 同步渲染首帧
            // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
            //    如需修改，一定要寻求同意"解锁"才可以。
            //
            // visible=true 和 _readyToRender=true 必须一同设置，
            // 紧跟同步渲染确保画布在调用方显示面板前已绘制完成。
            // 若去掉同步渲染或拆分旗标设置，旧画面可能残留或被空白帧替代。
            // ================================================================
            pp.visible = true;
            pp._readyToRender = true;
            SMTool._renderAnimPreview(performance.now());
            // 🔒 [LOCK-D] END

            // 更新面板标题
            SMTool._updateAppTitle('🎬 ' + targetAnim, node.sourceFile || '');

        } catch (e) {
            console.error('[AnimPreview] Setup failed:', e);
            SMTool._destroyAnimPreview();
        }
    }

    if (needLoad) {
        // 等待图片加载
        var loadedCount = 0;
        for (var pi2 = 0; pi2 < imgs.length; pi2++) {
            if (imgs[pi2].complete) {
                loadedCount++;
            } else {
                imgs[pi2].onload = function () {
                    loadedCount++;
                    if (loadedCount >= imgs.length) doSetup();
                };
                imgs[pi2].onerror = function () {
                    loadedCount++; // 仍然计数，避免卡住
                    if (loadedCount >= imgs.length) doSetup();
                };
            }
        }
        if (loadedCount >= imgs.length) doSetup();
    } else {
        doSetup();
    }
};

// ---- 渲染预览帧 ----
SMTool._renderAnimPreview = function (now) {
    var pp = SMData._animPreview;
    // ★ 层级节点预览（含测试模式）：多层叠加渲染
    if (pp && pp.visible && pp._layerSkeletons && pp._layerSkeletons.length > 0) {
        if (!pp._readyToRender || !pp.gl) return;
        // ★ 延迟结束后重建骨架
        if (pp._needsLayerRebuild && !(pp._startupDelayFrames > 0)) {
            pp._needsLayerRebuild = false;
            var layerNode = SMData.nodes.get(pp.nodeId);
            if (layerNode) {
                SMTool._showLayerPreview(layerNode);
            }
            // ★ 安全：重建后多清一帧，让 GPU 消化完纹理/Shader 创建再渲染
            pp._startupDelayFrames = 1;
        }
        // ★ 交错渲染已在 _renderLayerPreview 内部按每层骨架的 drawOrder 处理
        SMTool._renderLayerPreview(null, pp, now);
        // ★ 渲染骨骼挂图（重建期间跳过）
        if (!pp._needsLayerRebuild) {
            SMTool._renderLayerPreviewBoneImages(pp);
        }
        if (pp._needsLayerReinit) {
            pp._needsLayerReinit = false;
            var gl2 = pp.gl;
            var canvas2 = pp.canvas;
            if (gl2 && canvas2) {
                gl2.viewport(0, 0, canvas2.width, canvas2.height);
                gl2.clearColor(0, 0, 0, 0);
                gl2.clearStencil(0);
                gl2.clear(gl2.COLOR_BUFFER_BIT | gl2.STENCIL_BUFFER_BIT);
            }
            if (document.getElementById('appLayerList') && document.getElementById('appLayerList').style.display !== 'none') {
                SMTool._buildLayerList();
            }
        }
        return;
    }
    // ================================================================
    // 🔒🔒🔒 [LOCK-E] _readyToRender 守卫检查
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // _readyToRender 为 false 时禁止渲染，防止抓到 setup 中间态。
    // 必须与 [LOCK-B][LOCK-D] 配合，三者构成完整的安全屏障。
    // ================================================================
    if (!pp || !pp.visible || !pp._readyToRender || !pp.state || !pp.skeleton || !pp.gl) return;
    // 🔒 [LOCK-E] END

    var canvas = pp.canvas;
    var gl = pp.gl;
    var cw = pp._canvasWidth || canvas.width;
    var ch = pp._canvasHeight || canvas.height;
    var useVer = pp._spineVer;

    // ★ 单节点预览：从源节点读取播放倍速
    var previewSpeed = 1.0;
    if (pp.nodeId != null) {
        var srcNode = SMData.nodes.get(pp.nodeId);
        if (srcNode && typeof srcNode._playbackSpeed === 'number') previewSpeed = srcNode._playbackSpeed;
    }

    var dt = Math.min((now - (pp._lastTime || now)) / 1000, 0.1);
    pp._lastTime = now;

    // 更新动画（flow 播放暂停/结束时冻结预览）
    if (!pp._flowFrozen) {
        pp.state.update(dt * previewSpeed);
    }

    // ★ 预览面板双向 alpha 十字淡入淡出状态机（与主渲染循环逻辑一致）
    if (pp._cfState && pp.nodeId != null) {
        var ppCf = pp._cfState;
        var ppIs4x = (pp._spineVer === '4.3' || pp._spineVer === '4.2');
        var srcNode2 = SMData.nodes.get(pp.nodeId);
        if (srcNode2 && srcNode2._trackSequence) {
            if (ppCf.phase === 'waiting') {
                var ppBaseEntry = pp.state.getCurrent(ppCf.baseTrack);
                if (ppBaseEntry) {
                    var ppAnimDur = (ppBaseEntry.animation || ppBaseEntry._animation).duration;
                    if (ppAnimDur > 0) {
                        var ppRemaining = Math.max(0, ppAnimDur - ppBaseEntry.trackTime);
                        if (ppRemaining <= ppCf.mixOut + 0.001) {
                            var ppSeq = srcNode2._trackSequence[ppCf.ti];
                            var ppNextAnim = ppSeq.animations[ppCf.nextAnimIdx];
                            var ppOvEntry = pp.state.setAnimation(ppCf.overlayTrack, ppNextAnim.name, false);
                            if (ppOvEntry) {
                                ppOvEntry.alpha = 0;
                                ppOvEntry.mixBlend = SMTool._mixBlendValue('replace');
                                ppOvEntry.mixDuration = 0;
                                ppCf.phase = 'crossfading';
                                ppCf.elapsed = 0;
                            }
                        }
                    }
                }
            } else if (ppCf.phase === 'crossfading') {
                ppCf.elapsed += dt * previewSpeed;
                var ppProgress = Math.min(1, ppCf.elapsed / Math.max(ppCf.mixOut, 0.001));
                var ppBaseE = pp.state.getCurrent(ppCf.baseTrack);
                var ppOvE = pp.state.getCurrent(ppCf.overlayTrack);
                if (ppBaseE) ppBaseE.alpha = Math.max(0, (1 - ppProgress) * ppCf.seqAlpha);
                if (ppOvE) ppOvE.alpha = ppProgress * ppCf.seqAlpha;

                if (ppProgress >= 1) {
                    var ppSeq2 = srcNode2._trackSequence[ppCf.ti];
                    var ppNextAnim2 = ppSeq2.animations[ppCf.nextAnimIdx];
                    pp.state.clearTrack(ppCf.baseTrack);
                    var ppNewEntry = pp.state.setAnimation(ppCf.baseTrack, ppNextAnim2.name, false);
                    if (ppNewEntry) {
                        ppNewEntry.alpha = ppCf.seqAlpha;
                        if (ppIs4x && ppCf.seqMixBlend) ppNewEntry.mixBlend = SMTool._mixBlendValue(ppCf.seqMixBlend);
                        ppNewEntry.mixDuration = 0;
                    }
                    pp.state.clearTrack(ppCf.overlayTrack);
                    // ★ 清空已完成状态，防止下一帧重复触发
                    pp._cfState = null;
                    // ★ 手动序列模式：前进索引
                    var ppSrcNode3 = SMData.nodes.get(pp.nodeId);
                    if (ppSrcNode3) {
                        if (!ppSrcNode3._seqIdx) ppSrcNode3._seqIdx = {};
                        var ppNxt = ppCf.nextAnimIdx + 1;
                        var ppSeq3 = ppSrcNode3._trackSequence[ppCf.ti];
                        if (ppNxt >= ppSeq3.animations.length) ppNxt = (ppCf.loopSeq !== false) ? 0 : ppSeq3.animations.length - 1;
                        ppSrcNode3._seqIdx[ppCf.ti] = ppNxt;
                        // 同步清理主节点的 crossfade 状态
                        srcNode2._cfState = null;
                    }
                }
            }
        }
    }

    // ★ 预览面板：轨道模式序列循环重启（与主渲染循环逻辑一致，手动索引跟踪）
    var ppSrcNode3 = pp.nodeId != null ? SMData.nodes.get(pp.nodeId) : null;
    if (ppSrcNode3 && ppSrcNode3._trackMode && ppSrcNode3._trackSequence && !pp._flowFrozen) {
        if (!ppSrcNode3._seqIdx) ppSrcNode3._seqIdx = {};
        for (var ppSi = 0; ppSi < ppSrcNode3._trackSequence.length; ppSi++) {
            var ppRSeq2 = ppSrcNode3._trackSequence[ppSi];
            if (!ppRSeq2.enabled || ppRSeq2.loopSeq === false) continue;
            if (pp._cfState && pp._cfState.ti === ppSi) continue;
            
            var ppBT2 = ppSi * 2;
            var ppOT2 = ppSi * 2 + 1;
            var ppAnims2 = ppRSeq2.animations;
            if (!ppAnims2 || ppAnims2.length === 0) continue;
            
            if (ppSrcNode3._seqIdx[ppSi] === undefined || ppSrcNode3._seqIdx[ppSi] >= ppAnims2.length) {
                ppSrcNode3._seqIdx[ppSi] = 0;
            }
            
            var ppBE2 = pp.state.getCurrent(ppBT2);
            var ppOE2 = pp.state.getCurrent(ppOT2);
            var ppIdle2 = true;
            if (ppBE2) { try { if (typeof ppBE2.isComplete === 'function') ppIdle2 = ppBE2.isComplete(); else if (ppBE2.isComplete !== undefined) ppIdle2 = !!ppBE2.isComplete; } catch(e) {} }
            if (ppOE2) { try { if (typeof ppOE2.isComplete === 'function') ppIdle2 = ppIdle2 && ppOE2.isComplete(); else if (ppOE2.isComplete !== undefined) ppIdle2 = ppIdle2 && !!ppOE2.isComplete; } catch(e) {} }
            
            if (ppIdle2) {
                var ppNextIdx2 = ppSrcNode3._seqIdx[ppSi];
                var ppSelAnim2 = ppAnims2[ppNextIdx2];
                var ppRstEntry2 = pp.state.setAnimation(ppBT2, ppSelAnim2.name, false);
                if (ppRstEntry2) {
                    ppRstEntry2.alpha = (ppRSeq2.alpha !== undefined) ? ppRSeq2.alpha : 1.0;
                    ppRstEntry2.mixDuration = 0;
                    ppSrcNode3._seqIdx[ppSi] = (ppNextIdx2 + 1) % ppAnims2.length;
                }
            }
        }
    }

    // ★ 单节点动画播完后无缝从头重播（直接 setAnimation，不销毁重建）
    if (!pp._flowFrozen && pp.state && !pp._layerSkeletons) {
        var trackEntry = pp.state.getCurrent(0);
        var isComplete = false;
        if (trackEntry) {
            try {
                if (typeof trackEntry.isComplete === 'function') {
                    isComplete = trackEntry.isComplete();
                } else if (trackEntry.isComplete !== undefined) {
                    isComplete = !!trackEntry.isComplete;
                }
            } catch (e) { isComplete = false; }
        }
        if (isComplete) {
            // ★ 清除旧 timer（防止旧代码残留）
            if (pp._singleLoopTimer) {
                clearTimeout(pp._singleLoopTimer);
                pp._singleLoopTimer = null;
            }
            // ★ 使用 _loopRestartGuard 防止同一完成帧重复重启
            if (!pp._loopRestartGuard) {
                pp._loopRestartGuard = true;
                // 获取当前动画名（回退到骨架首个动画）
                var restartAnim = pp.animName;
                if (!restartAnim && pp._skeletonData && pp._skeletonData.animations && pp._skeletonData.animations.length > 0) {
                    restartAnim = pp._skeletonData.animations[0].name;
                }
                if (restartAnim) {
                    pp.state.setAnimation(0, restartAnim, false);
                }
            }
        } else {
            pp._loopRestartGuard = false;
        }
    }

    pp.state.apply(pp.skeleton);
    pp.skeleton.updateWorldTransform(pp._physParam);

    // 渲染
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    if (useVer === '4.3' || useVer === '4.2') {
        if (pp._sceneRenderer) {
            try {
                // ★ SceneRenderer 需要 begin/end 包围 drawSkeleton 才能刷出画面
                pp._sceneRenderer.begin();
                pp._sceneRenderer.drawSkeleton(pp.skeleton, pp._premultipliedAlpha || false);
                pp._sceneRenderer.end();
            } catch (e) { /* ignore */ }
            // ★ 4.x 路径：自定义插槽图片渲染在骨架之后（SceneRenderer 不支持分段交错）
            SMTool._renderPreviewSlotImages(pp);
        }
    } else {
        // 3.8 渲染：使用 webgl 子对象获取 Shader 常量
        var WGL = window.spine38 && window.spine38.webgl;
        if (!WGL || !WGL.Shader) return;
        if (pp._shader && pp._batcher && pp._skeletonRenderer && pp._mvp) {
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            // ★ 3.8 路径：按 drawOrder 精确分段交错渲染（自定义图片在正确层级）
            SMTool._renderPreviewSpine38Interleaved(pp, gl, WGL, cw, ch);
        }
    }

    // ★ 渲染预览浮窗骨骼挂图
    SMTool._renderPreviewBoneImages(pp);
};

// ---- 同步预览面板视口（缩放面板时调用，重新计算相机/投影/骨架位置） ----
SMTool._syncAnimPreviewViewport = function (pp, newW, newH) {
    if (!pp || !pp.skeleton || !pp.gl) return;

    var canvas = pp.canvas;
    // ★ 取 canvas 容器的实际像素尺寸（排除标题栏），避免拉伸
    var wrap = canvas ? canvas.parentElement : null;
    var actualW = (wrap && wrap.clientWidth > 10) ? wrap.clientWidth : (newW || pp._canvasWidth || 320);
    var actualH = (wrap && wrap.clientHeight > 10) ? wrap.clientHeight : (newH || pp._canvasHeight || 500);
    if (canvas) {
        canvas.width = actualW;
        canvas.height = actualH;
    }
    pp._canvasWidth = actualW;
    pp._canvasHeight = actualH;

    // ★ 用实际 canvas 尺寸（非面板尺寸）做 ortho 和居中
    var cw = actualW, ch = actualH;
    var sk = pp.skeleton;
    var useVer = pp._spineVer;
    var bo = pp._boundsOffset;
    var bs = pp._boundsSize;
    var zoom = pp._contentZoom || 1.0;

    // 重新居中骨架
    if (bo && bs) {
        sk.x = cw / 2 - (bo.x + bs.x / 2);
        sk.y = ch / 2 - (bo.y + bs.y / 2);
    }

    // 更新相机/投影矩阵（含内容缩放）
    if (useVer === '4.3' || useVer === '4.2') {
        if (pp._sceneRenderer) {
            pp._sceneRenderer.camera.position.set(cw / 2, ch / 2, 0);
            pp._sceneRenderer.camera.viewportWidth = cw / zoom;
            pp._sceneRenderer.camera.viewportHeight = ch / zoom;
            pp._sceneRenderer.camera.update();
        }
    } else {
        if (pp._mvp) {
            pp._mvp.ortho2d(cw / 2 - cw / (2 * zoom), ch / 2 - ch / (2 * zoom), cw / zoom, ch / zoom);
        }
    }

    // ★ 更新缩放标签
    SMTool._updateAnimPreviewZoomLabel(zoom);
};

// ---- 更新缩放标签 ----
SMTool._updateAnimPreviewZoomLabel = function (zoom) {
    var label = document.getElementById('appZoomLabel');
    if (label) {
        var pct = Math.round(zoom * 100);
        label.textContent = pct + '%';
        // 非 100% 时高亮显示
        var bar = document.getElementById('appZoomBar');
        if (bar) {
            if (pct === 100) {
                bar.classList.remove('visible');
            } else {
                bar.classList.add('visible');
            }
        }
    }
};

// ---- 重置预览缩放为 100% ----
SMTool._resetAnimPreviewZoom = function () {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible) return;
    pp._contentZoom = 1.0;
    // 🔒 [LOCK-1] 重置按钮回写 100% 到文件记录
    var sourceNode = SMData.nodes.get(pp.nodeId);
    if (sourceNode && sourceNode.sourceFile) {
        SMData._previewZooms[sourceNode.sourceFile] = 1.0;
    }
    // ★ 层级预览重置
    if (pp._layerSkeletons && pp._layerSkeletons.length > 0 && pp.nodeId) {
        SMData._previewZooms['_layer_' + pp.nodeId] = 1.0;
        SMTool._syncLayerPreviewViewport(pp);
        return;
    }
    var cw = pp._canvasWidth || pp.panelW || 385;
    var ch = pp._canvasHeight || pp.panelH || 645;
    SMTool._syncAnimPreviewViewport(pp, cw, ch);
};

// ---- 销毁预览资源 ----
SMTool._destroyAnimPreview = function () {
    var pp = SMData._animPreview;
    if (!pp) return;

    // ================================================================
    // 🔒🔒🔒 [LOCK-A] 销毁预览时禁止 gl.clear()
    // ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
    //    如需修改，一定要寻求同意"解锁"才可以。
    //
    // 销毁时清空画布会导致浏览器在同一帧合成空白画面，
    // 下一帧才渲染新内容 → 用户看到闪烁/切屏。
    // 旧画面必须保留在画布上，由新内容首帧渲染自然覆盖。
    // ================================================================

    if (pp.state) { try { pp.state.clearTracks(); } catch (e) {} }
    if (pp._sceneRenderer) { try { pp._sceneRenderer.dispose(); } catch (e) {} }
    if (pp._batcher) { try { pp._batcher.dispose(); } catch (e) {} }
    if (pp._shader) { try { pp._shader.dispose(); } catch (e) {} }

    // ★ 销毁层级节点预览的多层骨架资源
    if (pp._layerSkeletons) {
        for (var ls = 0; ls < pp._layerSkeletons.length; ls++) {
            var lsk = pp._layerSkeletons[ls];
            if (lsk.batcher) { try { lsk.batcher.dispose(); } catch (e) {} }
            if (lsk.shader) { try { lsk.shader.dispose(); } catch (e) {} }
            if (lsk.skeletonRenderer) { try { lsk.skeletonRenderer.dispose(); } catch (e) {} }
            if (lsk.glTextures) {
                for (var gt = 0; gt < lsk.glTextures.length; gt++) {
                    try { lsk.glTextures[gt].dispose(); } catch (e) {}
                }
            }
        }
        pp._layerSkeletons = null;
    }
    pp._layerPreview = false;
    pp._layerPosMode = null;
    // ★ 清理自动循环定时器
    if (pp._singleLoopTimer) { clearTimeout(pp._singleLoopTimer); pp._singleLoopTimer = null; }
    if (pp._loopRestartTimer) { clearTimeout(pp._loopRestartTimer); pp._loopRestartTimer = null; }
    // ★★ 清理嵌套播放树缓存
    pp._subtreeCache = {};
    pp._playbackTree = null;
    pp._layerPlaybackState = null;

    // ★ 直接销毁预览专属纹理（独立 GL 上下文，不在共享缓存中）
    if (pp._glTextures) {
        for (var i = 0; i < pp._glTextures.length; i++) {
            try { pp._glTextures[i].dispose(); } catch (e) {}
        }
    }
    // ★ 销毁预览专属骨骼挂图资源（独立 GL 上下文）
    if (pp._boneTexCache && pp.gl) {
        var btcKeys = Object.keys(pp._boneTexCache);
        for (var b = 0; b < btcKeys.length; b++) {
            try { pp._boneTexCache[btcKeys[b]].texture.dispose(); } catch (e) {}
        }
        pp._boneTexCache = null;
    }
    if (pp._boneQR && pp.gl) {
        try { pp.gl.deleteProgram(pp._boneQR.prog); } catch (e) {}
        try { pp.gl.deleteBuffer(pp._boneQR.vbo); } catch (e) {}
        pp._boneQR = null;
    }

    // 重置状态
    pp._readyToRender = false;
    pp.canvas = null;
    pp.gl = null;
    pp.skeleton = null;
    pp.state = null;
    pp.animName = '';
    pp.nodeId = null;
    pp._sceneRenderer = null;
    pp._batcher = null;
    pp._shader = null;
    pp._glTextures = [];
    pp._texImgs = [];
    pp._texCacheKeys = [];
    pp._atlasData = null;
    pp._skeletonData = null;
    pp._skeletonRenderer = null;
    pp._mvp = null;
    pp._boundsOffset = null;
    pp._boundsSize = null;
    pp._premultipliedAlpha = false;
    pp._lastTime = 0;
    pp._loopRestartGuard = false;

    // ★ 清除层级播放高亮状态，防止主画布节点残留冻结/置灰
    SMData._layerPlayingNodes = null;
    SMData._layerAllChainNodes = null;
};

// ---- 更新预览动画（完整轨道混合复制） ----
SMTool._updateAnimPreviewAnim = function (animName) {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible || !pp.state || !pp._skeletonData) return;

    // 从源节点读取完整的轨道配置
    var node = SMData.nodes.get(pp.nodeId);
    if (!node || !node.state) return;

    // ★ 完整复制源节点的轨道混合配置
    SMTool._applyPreviewTracks(pp, pp.state, new (SMTool._getSpineRuntime(pp._spineVer)).AnimationStateData(pp._skeletonData), pp._skeletonData, node);
    pp.animName = node.currentAnim || animName;

    // ★ 同步 PMA 和皮肤
    SMTool._syncPreviewPmaAndSkin(pp, node);

    SMTool._updateAppTitle('🎬 ' + pp.animName, node.sourceFile || '');
};

// ---- 将源节点的轨道混合配置复制到预览 AnimationState ----
SMTool._applyPreviewTracks = function (pp, previewState, stateData, skeletonData, sourceNode) {
    // ★ 轨道动画模式：使用序列配置（双轨架构），而非旧的 node.tracks
    if (sourceNode._trackMode && sourceNode._trackSequence && sourceNode._trackSequence.length > 0) {
        SMTool._applyPreviewTrackSequence(pp, previewState, skeletonData, sourceNode);
        return;
    }

    previewState.clearTracks();
    // ★ 清除轨道后立刻重置骨骼到绑定姿态，防止上一动画最后一帧残留闪烁
    if (pp.skeleton) pp.skeleton.setToSetupPose();

    var tracks = sourceNode.tracks;
    if (!tracks || tracks.length === 0) {
        // 没有轨道配置 → 只播放 currentAnim
        var anim = sourceNode.currentAnim || (sourceNode.animations[0] && sourceNode.animations[0].name) || '';
        if (anim) {
            previewState.setAnimation(0, anim, sourceNode.loop !== false);
        }
        pp.animName = anim;
        return;
    }

    var is4x = (pp._spineVer === '4.3' || pp._spineVer === '4.2');

    for (var ti = 0; ti < tracks.length; ti++) {
        var track = tracks[ti];
        if (!track.enabled || !track.animName) continue;

        // 验证动画存在于骨架中
        var animExists = false;
        for (var ai = 0; ai < skeletonData.animations.length; ai++) {
            if (skeletonData.animations[ai].name === track.animName) { animExists = true; break; }
        }
        if (!animExists) continue;

        var entry = previewState.setAnimation(ti, track.animName, track.loop !== false);
        if (entry) {
            if (track.alpha !== undefined && track.alpha >= 0 && track.alpha <= 1) {
                entry.alpha = track.alpha;
            }
            if (is4x && track.mixBlend) {
                entry.mixBlend = SMTool._mixBlendValue(track.mixBlend);
            }
            // ★ 同步混合过渡时间
            if (track.mixDuration !== undefined && track.mixDuration > 0) {
                entry.mixDuration = track.mixDuration;
            }
        }
    }

    pp.animName = sourceNode.currentAnim || (tracks.length > 0 ? tracks[0].animName : '');

    // ▲ flow 播放时强制不循环（flow 控制节奏）；非 flow 时跟随节点自身循环设置
    // ★ 但若源节点显式配置了循环模式（次数/时间），则让动画自然循环播放，
    //    由动画流定时器（timerDelay）控制何时推进到下一步，避免画面冻结。
    if (SMData._fullPlayback && SMData._fullPlayback.isPlaying) {
        var hasLoopMode = sourceNode.loop !== false && !!(sourceNode._loopMode || (sourceNode._loopCount !== undefined && sourceNode._loopCount !== 1));
        if (!hasLoopMode) {
            for (var ti = 0; ti < 5; ti++) {
                var e = previewState.getCurrent(ti);
                if (e) e.loop = false;
            }
        }
    }

    // ★ 立即应用第一帧，消除 setup pose 闪烁
    previewState.update(0);
    previewState.apply(pp.skeleton);
    pp.skeleton.updateWorldTransform(pp._physParam);
};

// ★ 将源节点的轨道序列配置复制到预览 AnimationState（与 _applyTrackSequence 双轨架构对应）
SMTool._applyPreviewTrackSequence = function (pp, previewState, skeletonData, sourceNode) {
    if (!previewState || !sourceNode || !sourceNode._trackMode) return;
    if (!sourceNode._trackSequence || sourceNode._trackSequence.length === 0) return;

    // ★ Bug1修复：先复位骨架
    if (pp.skeleton) pp.skeleton.setToSetupPose();
    previewState.clearTracks();

    var is4x = (pp._spineVer === '4.3' || pp._spineVer === '4.2');
    var seqs = sourceNode._trackSequence;

    pp._cfState = null;

    for (var ti = 0; ti < seqs.length; ti++) {
        var seq = seqs[ti];
        if (!seq.enabled) continue;
        var anims = seq.animations;
        if (!anims || anims.length === 0) continue;

        var baseTrack = ti * 2;
        var overlayTrack = ti * 2 + 1;

        // 首动画 → 基础轨
        var first = anims[0];
        var entry = previewState.setAnimation(baseTrack, first.name, false);
        if (!entry) continue;
        entry.alpha = (seq.alpha !== undefined) ? seq.alpha : 1.0;
        if (is4x && seq.mixBlend) entry.mixBlend = SMTool._mixBlendValue(seq.mixBlend);
        entry.mixDuration = 0;

        // 后续动画链
        for (var ai = 1; ai < anims.length; ai++) {
            var prev = anims[ai - 1];
            var cur = anims[ai];
            if (prev.mixOut > 0) {
                if (!pp._cfState) {
                    pp._cfState = {
                        ti: ti, baseTrack: baseTrack, overlayTrack: overlayTrack,
                        animIdx: ai - 1, nextAnimIdx: ai,
                        mixOut: prev.mixOut, elapsed: 0,
                        phase: 'waiting',
                        seqAlpha: seq.alpha,
                        seqMixBlend: seq.mixBlend || 'replace',
                        loopSeq: seq.loopSeq !== false
                    };
                }
                break;
            } else {
                entry = previewState.addAnimation(baseTrack, cur.name, false, 0);
                if (entry) {
                    entry.alpha = seq.alpha;
                    if (is4x && seq.mixBlend) entry.mixBlend = SMTool._mixBlendValue(seq.mixBlend);
                    entry.mixDuration = 0;
                }
            }
        }
    }

    // ★ 立即应用第一帧
    previewState.update(0);
    previewState.apply(pp.skeleton);
    pp.skeleton.updateWorldTransform(pp._physParam);
};

// ---- 同步预览浮窗的 PMA 和皮肤到源节点状态 ----
SMTool._syncPreviewPmaAndSkin = function (pp, sourceNode) {
    if (!pp || !pp.skeleton || !pp._skeletonData || !sourceNode) return;

    // ★ 同步 PMA（3.8 通过 skeletonRenderer 标志；4.x 已烘焙到纹理，运行时不可变更）
    if (sourceNode.premultipliedAlpha !== undefined && pp._spineVer !== '4.3' && pp._spineVer !== '4.2') {
        pp._premultipliedAlpha = !!sourceNode.premultipliedAlpha;
    }

    // ★ 同步皮肤：从源节点 currentSkin 找到对应皮肤对象并应用到预览骨架
    var skinName = sourceNode.currentSkin;
    if (skinName && pp._skeletonData.skins) {
        var skin = null;
        for (var i = 0; i < pp._skeletonData.skins.length; i++) {
            if (pp._skeletonData.skins[i].name === skinName) {
                skin = pp._skeletonData.skins[i];
                break;
            }
        }
        if (skin) {
            pp.skeleton.setSkin(skin);
            pp.skeleton.setSlotsToSetupPose();
        }
    }
};

SMTool._syncZoomUI = function () {
    var pct = Math.round(SMData.view.zoom * 100);
    document.getElementById('zoomLabel').textContent = pct + '%';
    var slider = document.getElementById('zoomSlider');
    var sliderVal = Math.round(pct);
    if (sliderVal < 0) sliderVal = 0;
    if (sliderVal > 200) sliderVal = 200;
    if (Math.abs(parseInt(slider.value) - sliderVal) > 1) slider.value = sliderVal;
    // 非 100% 时显示恢复按钮
    var btn = document.getElementById('zoomResetBtn');
    if (btn) btn.style.display = (pct !== 100) ? '' : 'none';
};

// ---- 适合视图 / 重置视图 ----
SMTool.fitAll = function () {
    if (!SMData.nodes.size) return;
    var mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        mx = Math.min(mx, n.x);
        my = Math.min(my, n.y);
        Mx = Math.max(Mx, n.x + n.width);
        My = Math.max(My, n.y + 400);
        result = nodesIter.next();
    }
    SMData.view.zoom = Math.min(window.innerWidth / (Mx - mx + 200), window.innerHeight / (My - my + 200), 2);
    SMData.view.x = -(mx + Mx) / 2;
    SMData.view.y = -(my + My) / 2;
    // ★ forceSync=true：缩放变化必须同步更新 DOM
    SMTool._updateAllPos(true);
    SMTool._syncZoomUI();
};

SMTool.resetView = function () {
    SMData.view = { x: 0, y: 0, zoom: 1 };
    // ★ forceSync=true：缩放变化必须同步更新 DOM
    SMTool._updateAllPos(true);
    SMTool._syncZoomUI();
};

// ---- 空格键平移 ----
SMTool._onPanStart = function (e) {
    SMData.isPanning = true;
    SMData.panStart = { x: e.clientX, y: e.clientY };
    SMData.viewStart = { x: SMData.view.x, y: SMData.view.y };
};

SMTool._onPanMove = function (e) {
    if (!SMData.isPanning) return;
    SMData.view.x = SMData.viewStart.x + (e.clientX - SMData.panStart.x) / SMData.view.zoom;
    SMData.view.y = SMData.viewStart.y + (e.clientY - SMData.panStart.y) / SMData.view.zoom;
    SMTool._updateAllPos();
};

SMTool._onPanEnd = function () {
    SMData.isPanning = false;
};

// ---- 调整大小 ----
SMTool.resize = function () {
    SMTool.gridCanvas.width = window.innerWidth;
    SMTool.gridCanvas.height = window.innerHeight;
    SMTool.connCanvas.width = window.innerWidth;
    SMTool.connCanvas.height = window.innerHeight;
    SMTool._resizeSharedRenderer();
};

// ================================================================
// ★ 事件帧气泡提示 — 动画播放到事件帧时在节点旁弹出气泡
// ================================================================

// 提取节点的当前动画事件帧数据（缓存到 node._eventFrames，动画切换时自动重建）
SMTool._ensureEventFrames = function (node) {
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    // 动画名变了 → 清缓存重建
    if (node._eventFrames && node._cachedEventAnim === animName) return;
    node._eventFrames = null;
    node._cachedEventAnim = animName;
    node._lastEventCheckTime = 0;
    if (!node.skeletonData) return;
    var animName = node.currentAnim || (node.animations.length > 0 ? node.animations[0].name : '');
    if (!animName) return;
    var sd = node.skeletonData;
    var anim = null;
    for (var ai = 0; ai < sd.animations.length; ai++) {
        if (sd.animations[ai].name === animName) { anim = sd.animations[ai]; break; }
    }
    if (!anim) return;
    var frames = [];
    var timelines = anim.timelines || (typeof anim.getTimelines === 'function' ? anim.getTimelines() : []);
    for (var ti = 0; ti < timelines.length; ti++) {
        var tl = timelines[ti];
        if (!tl.frames || !tl.events) continue;
        for (var fi = 0; fi < tl.events.length; fi++) {
            var evt = tl.events[fi];
            var name = evt.data ? evt.data.name : (evt.name || '');
            if (!name) continue;
            frames.push({ time: tl.frames[fi] || 0, name: name });
        }
    }
    node._eventFrames = frames;
    node._lastEventCheckTime = 0;
};

// 显示事件气泡（复用节点上的气泡元素，避免反复创建DOM）
SMTool._showEventBubble = function (node, eventFrame) {
    var el = SMTool._getEl(node.id);
    if (!el) return;
    var bubble = el.querySelector('.event-bubble');
    if (!bubble) {
        bubble = document.createElement('div');
        bubble.className = 'event-bubble';
        bubble.innerHTML = '<span class="event-bubble-name"></span><span class="event-bubble-time"></span>';
        el.appendChild(bubble);
    }
    // 更新内容
    bubble.querySelector('.event-bubble-name').textContent = eventFrame.name;
    bubble.querySelector('.event-bubble-time').textContent = eventFrame.time.toFixed(2) + 's';
    // 重新触发动画：移除类→强制回流→加回类
    bubble.classList.remove('event-bubble');
    void bubble.offsetWidth;
    bubble.classList.add('event-bubble');
};

// ================================================================
// ★ 骨骼挂图渲染 — 将骨骼截图以程序化挂点方式绑定到 Spine 骨骼
//    跟随骨骼的位移/旋转/缩放，在动画节点和预览浮窗内实时渲染
// ================================================================

// 骨骼图片 GL 纹理缓存（主画布共享）
// { shotId: { texture, img, width, height } }
SMTool._boneTexCache = {};

// 骨骼挂图四边形渲染器（主画布）
SMTool._boneQR = null;

// ---- 编译骨骼挂图着色器程序 ----
SMTool._createBoneQuadRenderer = function (gl) {
    var vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, [
        'attribute vec2 a_pos;',
        'attribute vec2 a_uv;',
        'uniform mat4 u_mvp;',
        'varying vec2 v_uv;',
        'void main() {',
        '  gl_Position = u_mvp * vec4(a_pos, 0.0, 1.0);',
        '  v_uv = a_uv;',
        '}'
    ].join('\n'));
    gl.compileShader(vs);

    var fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, [
        'precision mediump float;',
        'varying vec2 v_uv;',
        'uniform sampler2D u_tex;',
        'uniform float u_alpha;',
        'uniform vec4 u_color;',
        'void main() {',
        '  vec4 c = texture2D(u_tex, v_uv);',
        '  gl_FragColor = vec4(c.rgb * u_color.rgb, c.a * u_alpha * u_color.a);',
        '}'
    ].join('\n'));
    gl.compileShader(fs);

    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.warn('[BoneQR] Shader link failed:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
    }

    // ★ 设置 u_color 默认值为白色 (1,1,1,1)，后续可按需覆写
    var uColorLoc = gl.getUniformLocation(prog, 'u_color');
    gl.useProgram(prog);
    gl.uniform4f(uColorLoc, 1, 1, 1, 1);
    gl.useProgram(null);

    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // 单位正方形，中心在原点：(pos.x, pos.y, uv.u, uv.v)
    // UV V 坐标翻转：WebGL texImage2D 上传 HTML Image 时第一行在顶部，
    // 而 GL 纹理坐标 (0,0) 指向纹理数据第一行，即图片顶部
    var verts = new Float32Array([
        -0.5, -0.5,  0.0, 1.0,
         0.5, -0.5,  1.0, 1.0,
        -0.5,  0.5,  0.0, 0.0,
         0.5,  0.5,  1.0, 0.0
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    return {
        prog: prog,
        vbo: vbo,
        aPos: gl.getAttribLocation(prog, 'a_pos'),
        aUV: gl.getAttribLocation(prog, 'a_uv'),
        uMVP: gl.getUniformLocation(prog, 'u_mvp'),
        uTex: gl.getUniformLocation(prog, 'u_tex'),
        uAlpha: gl.getUniformLocation(prog, 'u_alpha'),
        uColor: gl.getUniformLocation(prog, 'u_color')
    };
};

// ---- 设置 slot 的混合模式 ----
SMTool._applySlotBlendMode = function (gl, blendMode) {
    // Spine blendMode: 0=normal, 1=additive, 2=multiply, 3=screen
    if (blendMode === 1) {
        // Additive
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    } else if (blendMode === 2) {
        // Multiply
        gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
    } else if (blendMode === 3) {
        // Screen
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    } else {
        // Normal (0 or default)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
};

// ---- 获取或创建骨骼图片的 GL 纹理 ----
SMTool._ensureBoneTexture = function (gl, shotId) {
    if (SMTool._boneTexCache[shotId]) return SMTool._boneTexCache[shotId].texture;

    var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
    if (!dataUrl) return null;

    var img = new Image();
    img.src = dataUrl;

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // 占位 1x1 透明像素
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    var entry = { texture: tex, img: img, uploaded: false };
    SMTool._boneTexCache[shotId] = entry;

    img.onload = function () {
        entry.uploaded = false; // 标记需要重新上传
    };

    return tex;
};

// ---- 上传已加载的图片到 GL 纹理 ----
SMTool._uploadBoneTexture = function (gl, shotId) {
    var entry = SMTool._boneTexCache[shotId];
    if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
    try {
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        entry.uploaded = true;
    } catch (e) {
        // 跨域或其他错误，忽略
    }
};

// ---- 构建正交投影矩阵（Y-down，屏幕空间） ----
SMTool._orthoM4 = function (out, l, r, b, t, n, f) {
    out.fill(0);
    out[0] = 2 / (r - l);
    out[5] = 2 / (t - b);
    out[10] = -2 / (f - n);
    out[12] = -(r + l) / (r - l);
    out[13] = -(t + b) / (t - b);
    out[14] = -(f + n) / (f - n);
    out[15] = 1;
};

// ---- 从骨骼世界矩阵直接构建模型矩阵（绕过角度提取，消除旋转方向不匹配） ----
// 直接使用骨骼的 a/b/c/d/worldX/worldY 分量统一通过角度+缩放方式构建矩阵
// ★ 统一使用 angle+scale 方式（与 _modelM4 完全一致），避免直接使用 bone.a/b/c/d 可能引入的坐标系差异
SMTool._boneM4 = function (out, bone, offX, offY, imgW, imgH) {
    out.fill(0);
    var bx, by, angle, scaleX, scaleY;
    if (typeof bone.getWorldX === 'function') {
        bx = bone.getWorldX(); by = bone.getWorldY();
        angle = (typeof bone.getWorldRotationX === 'function') ? (-bone.getWorldRotationX() * Math.PI / 180) : 0;  // ★ 取反
        scaleX = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
        scaleY = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
    } else {
        bx = bone.worldX; by = bone.worldY;
        angle = -Math.atan2(bone.b, bone.a);  // ★ 取反：骨骼旋转方向与图片视觉方向匹配
        scaleX = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
        scaleY = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
    }
    var cos = Math.cos(angle), sin = Math.sin(angle);
    out[0] = cos * scaleX * imgW;
    out[1] = sin * scaleX * imgW;
    out[4] = -sin * scaleY * imgH;
    out[5] = cos * scaleY * imgH;
    out[12] = bx + offX;
    out[13] = by + offY;
    out[10] = 1;
    out[15] = 1;
};

// ---- 构建 2D 模型矩阵（平移 + 旋转 + 缩放） ----
SMTool._modelM4 = function (out, tx, ty, angle, sx, sy) {
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    out.fill(0);
    out[0] = cos * sx;
    out[1] = sin * sx;
    out[4] = -sin * sy;
    out[5] = cos * sy;
    out[12] = tx;
    out[13] = ty;
    out[10] = 1;
    out[15] = 1;
};

// ---- 4x4 矩阵乘法：out = a * b ----
SMTool._mulM4 = function (out, a, b) {
    for (var i = 0; i < 4; i++) {
        for (var j = 0; j < 4; j++) {
            out[i + j * 4] = a[i] * b[j * 4] + a[i + 4] * b[1 + j * 4] + a[i + 8] * b[2 + j * 4] + a[i + 12] * b[3 + j * 4];
        }
    }
};

// ---- 保存关键 GL 状态 ----
SMTool._saveGL = function (gl) {
    return {
        prog: gl.getParameter(gl.CURRENT_PROGRAM),
        blend: gl.isEnabled(gl.BLEND),
        blendSrc: gl.getParameter(gl.BLEND_SRC_RGB),
        blendDst: gl.getParameter(gl.BLEND_DST_RGB),
        tex2D: gl.getParameter(gl.TEXTURE_BINDING_2D),
        activeTex: gl.getParameter(gl.ACTIVE_TEXTURE),
        arrBuf: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        vp: gl.getParameter(gl.VIEWPORT)
    };
};

// ---- 恢复关键 GL 状态 ----
SMTool._restoreGL = function (gl, s) {
    gl.useProgram(s.prog);
    if (s.blend) { gl.enable(gl.BLEND); } else { gl.disable(gl.BLEND); }
    gl.blendFunc(s.blendSrc, s.blendDst);
    gl.activeTexture(s.activeTex);
    gl.bindTexture(gl.TEXTURE_2D, s.tex2D);
    gl.bindBuffer(gl.ARRAY_BUFFER, s.arrBuf);
    gl.viewport(s.vp[0], s.vp[1], s.vp[2], s.vp[3]);
};

// ================================================================
// ★ 交错渲染：按 drawOrder 精确分段渲染 Spine 骨架 + 自定义插槽图片
// 自定义图片精确出现在其对应 slot 在 drawOrder 中的层级位置，
// 而不是全部在骨架上方或下方。
// ================================================================
SMTool._renderSpine38Interleaved = function (node, gl, WGL, nodeW, nodeH, sx, glY, sw, sh) {
    var skeleton = node.skeleton;
    var drawOrder = skeleton.drawOrder;
    if (!drawOrder || drawOrder.length === 0) return;

    // ★ 构建 slot 名 → drawOrder 索引的映射，并标出哪些 slot 有自定义图片
    var slotDrawIdx = {};       // slotName → drawOrder index
    var slotBoneMap = {};       // slotName → Bone
    var slotObjMap = {};        // slotName → Slot 对象（用于读取 color/blendMode）
    var customDrawIndices = []; // [{slotName, drawIdx, bone, slot}]

    for (var di = 0; di < drawOrder.length; di++) {
        var sl = drawOrder[di];
        var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
        slotDrawIdx[nm] = di;
        if (sl.bone) slotBoneMap[nm] = sl.bone;
        slotObjMap[nm] = sl;
    }

    // 收集有自定义图片的 slot
    if (node._slotScreenshots && !SMData._hideBoneImgs) {
        var slotNames = Object.keys(node._slotScreenshots);
        for (var sni = 0; sni < slotNames.length; sni++) {
            var sn = slotNames[sni];
            var shotIds = node._slotScreenshots[sn];
            if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
            if (shotIds.length === 0) continue;
            // 检查是否全部未挂载
            var anyMounted = true;
            if (node._slotShotMounted && node._slotShotMounted[sn]) {
                anyMounted = false;
                for (var mi = 0; mi < shotIds.length; mi++) {
                    if (node._slotShotMounted[sn][mi] !== false) { anyMounted = true; break; }
                }
            }
            if (!anyMounted) continue;
            var idx = slotDrawIdx[sn];
            if (idx !== undefined) {
                customDrawIndices.push({ slotName: sn, drawIdx: idx, bone: slotBoneMap[sn], slot: slotObjMap[sn] });
            }
        }
    }

    // 无自定义图片 → 正常渲染
    if (customDrawIndices.length === 0) {
        node.shader.bind();
        node.shader.setUniformi(WGL.Shader.SAMPLER, 0);
        node.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, node.mvp.values);
        node.batcher.begin(node.shader);
        node.skeletonRenderer.premultipliedAlpha = node.premultipliedAlpha;
        node.skeletonRenderer.draw(node.batcher, node.skeleton);
        node.batcher.end();
        node.shader.unbind();
        return;
    }

    // ★ 按 drawIdx 排序
    customDrawIndices.sort(function (a, b) { return a.drawIdx - b.drawIdx; });

    // ★ 分段渲染
    var allDrawOrder = drawOrder.slice(); // 保存原始 drawOrder
    var prevEnd = 0;

    node.shader.bind();
    node.shader.setUniformi(WGL.Shader.SAMPLER, 0);
    node.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, node.mvp.values);

    // 懒初始化四边形渲染器
    if (!SMTool._boneQR && gl) {
        SMTool._boneQR = SMTool._createBoneQuadRenderer(gl);
    }
    var qr = SMTool._boneQR;

    for (var ci = 0; ci < customDrawIndices.length; ci++) {
        var cs = customDrawIndices[ci];
        var segEnd = cs.drawIdx + 1; // 渲染到此 slot（含）

        // 渲染 Spine 段：prevEnd → segEnd
        if (segEnd > prevEnd) {
            skeleton.drawOrder = allDrawOrder.slice(prevEnd, segEnd);
            node.batcher.begin(node.shader);
            node.skeletonRenderer.premultipliedAlpha = node.premultipliedAlpha;
            node.skeletonRenderer.draw(node.batcher, node.skeleton);
            node.batcher.end();
        }

        // ★ 在此 slot 的 Spine 内容之后渲染自定义图片
        if (qr && cs.bone) {
            gl.viewport(sx, glY, sw, sh);
            gl.scissor(sx, glY, sw, sh);
            gl.enable(gl.SCISSOR_TEST);
            SMTool._renderSingleSlotImages(node, gl, qr, cs.slotName, cs.bone, cs.slot, nodeW, nodeH);
        }

        prevEnd = segEnd;
    }

    // ★ 渲染剩余的 Spine 段
    if (prevEnd < allDrawOrder.length) {
        skeleton.drawOrder = allDrawOrder.slice(prevEnd);
        node.batcher.begin(node.shader);
        node.skeletonRenderer.premultipliedAlpha = node.premultipliedAlpha;
        node.skeletonRenderer.draw(node.batcher, node.skeleton);
        node.batcher.end();
    }

    // ★ 恢复原始 drawOrder
    skeleton.drawOrder = allDrawOrder;

    node.shader.unbind();
};

// ★ 渲染单个 slot 的所有自定义图片（在交错渲染的间隙调用）
SMTool._renderSingleSlotImages = function (node, gl, qr, slotName, bone, slot, nodeW, nodeH) {
    var shotIds = node._slotScreenshots[slotName];
    if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
    if (shotIds.length === 0 || !qr) return;

    // 保存 GL 状态
    var saved = SMTool._saveGL(gl);

    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, 0, nodeW, 0, nodeH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(nodeH * 0.2, 250), 80);

    for (var ssi = 0; ssi < shotIds.length; ssi++) {
        var shotId = shotIds[ssi];
        if (typeof shotId !== 'number') continue;
        if (node._slotShotMounted && node._slotShotMounted[slotName] && node._slotShotMounted[slotName][ssi] === false) continue;

        var tex = SMTool._ensureBoneTexture(gl, shotId);
        if (!tex) continue;
        SMTool._uploadBoneTexture(gl, shotId);

        var drawW = defSize, drawH = defSize;
        var texEntry = SMTool._boneTexCache[shotId];
        if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
            drawW = texEntry.img.width;
            drawH = texEntry.img.height;
        }

        var offX = ssi * 5, offY = ssi * 5;

        var model = new Float32Array(16);
        SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

        var mvp = new Float32Array(16);
        SMTool._mulM4(mvp, ortho, model);
        gl.uniformMatrix4fv(qr.uMVP, false, mvp);

        // ★ 应用 slot 的 color（色调 + 透明度）和 blendMode
        var slotColor = (slot && slot.color) ? slot.color : null;
        var slotR = slotColor ? (typeof slotColor.r === 'number' ? slotColor.r : 1) : 1;
        var slotG = slotColor ? (typeof slotColor.g === 'number' ? slotColor.g : 1) : 1;
        var slotB = slotColor ? (typeof slotColor.b === 'number' ? slotColor.b : 1) : 1;
        var slotA = slotColor ? (typeof slotColor.a === 'number' ? slotColor.a : 1) : 1;
        gl.uniform4f(qr.uColor, slotR, slotG, slotB, 1.0);
        gl.uniform1f(qr.uAlpha, 0.9 * slotA);

        // ★ 应用 slot 的 blendMode
        var blendMode = 0;
        if (slot && slot.data && typeof slot.data.blendMode === 'number') {
            blendMode = slot.data.blendMode;
        }
        SMTool._applySlotBlendMode(gl, blendMode);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    SMTool._restoreGL(gl, saved);
};

// ★ 预览浮窗专用：按 drawOrder 分段交错渲染（3.8 路径）
SMTool._renderPreviewSpine38Interleaved = function (pp, gl, WGL, cw, ch) {
    var skeleton = pp.skeleton;
    var drawOrder = skeleton.drawOrder;
    if (!drawOrder || drawOrder.length === 0) {
        // 无 drawOrder → 正常渲染
        pp._shader.bind();
        pp._shader.setUniformi(WGL.Shader.SAMPLER, 0);
        pp._shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, pp._mvp.values);
        pp._batcher.begin(pp._shader);
        pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
        pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
        pp._batcher.end();
        pp._shader.unbind();
        return;
    }

    // 获取源节点的插槽图片
    var srcNode = (pp.nodeId != null) ? SMData.nodes.get(pp.nodeId) : null;
    if (!srcNode || !srcNode._slotScreenshots) {
        // 无自定义图片 → 正常渲染
        pp._shader.bind();
        pp._shader.setUniformi(WGL.Shader.SAMPLER, 0);
        pp._shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, pp._mvp.values);
        pp._batcher.begin(pp._shader);
        pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
        pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
        pp._batcher.end();
        pp._shader.unbind();
        return;
    }

    // 构建 drawOrder 索引映射
    var slotDrawIdx = {};
    var slotBoneMap = {};
    var slotObjMap = {};
    for (var di = 0; di < drawOrder.length; di++) {
        var sl = drawOrder[di];
        var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
        slotDrawIdx[nm] = di;
        if (sl.bone) slotBoneMap[nm] = sl.bone;
        slotObjMap[nm] = sl;
    }

    // 收集有自定义图片的 slot
    var slotNames = Object.keys(srcNode._slotScreenshots);
    var customDrawIndices = [];
    for (var sni = 0; sni < slotNames.length; sni++) {
        var sn = slotNames[sni];
        var shotIds = srcNode._slotScreenshots[sn];
        if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
        if (shotIds.length === 0) continue;
        var anyMounted = true;
        if (srcNode._slotShotMounted && srcNode._slotShotMounted[sn]) {
            anyMounted = false;
            for (var mi = 0; mi < shotIds.length; mi++) {
                if (srcNode._slotShotMounted[sn][mi] !== false) { anyMounted = true; break; }
            }
        }
        if (!anyMounted) continue;
        var idx = slotDrawIdx[sn];
        if (idx !== undefined) {
            customDrawIndices.push({ slotName: sn, drawIdx: idx, bone: slotBoneMap[sn], slot: slotObjMap[sn] });
        }
    }

    if (customDrawIndices.length === 0) {
        pp._shader.bind();
        pp._shader.setUniformi(WGL.Shader.SAMPLER, 0);
        pp._shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, pp._mvp.values);
        pp._batcher.begin(pp._shader);
        pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
        pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
        pp._batcher.end();
        pp._shader.unbind();
        return;
    }

    customDrawIndices.sort(function (a, b) { return a.drawIdx - b.drawIdx; });

    var allDrawOrder = drawOrder.slice();
    var prevEnd = 0;

    pp._shader.bind();
    pp._shader.setUniformi(WGL.Shader.SAMPLER, 0);
    pp._shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, pp._mvp.values);

    // 懒初始化预览四边形渲染器
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {};
    }
    var qr = pp._boneQR;

    for (var ci = 0; ci < customDrawIndices.length; ci++) {
        var cs = customDrawIndices[ci];
        var segEnd = cs.drawIdx + 1;

        if (segEnd > prevEnd) {
            skeleton.drawOrder = allDrawOrder.slice(prevEnd, segEnd);
            pp._batcher.begin(pp._shader);
            pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
            pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
            pp._batcher.end();
        }

        // 渲染自定义图片（传入 slot 对象以应用 color/blendMode）
        if (qr && cs.bone) {
            SMTool._renderSingleSlotImagesForPreview(pp, gl, qr, cs.slotName, cs.bone, cs.slot, cw, ch, srcNode);
        }

        prevEnd = segEnd;
    }

    if (prevEnd < allDrawOrder.length) {
        skeleton.drawOrder = allDrawOrder.slice(prevEnd);
        pp._batcher.begin(pp._shader);
        pp._skeletonRenderer.premultipliedAlpha = pp._premultipliedAlpha || false;
        pp._skeletonRenderer.draw(pp._batcher, pp.skeleton);
        pp._batcher.end();
    }

    skeleton.drawOrder = allDrawOrder;
    pp._shader.unbind();
};

// ★ 渲染单个 slot 的自定义图片（预览浮窗专用）
SMTool._renderSingleSlotImagesForPreview = function (pp, gl, qr, slotName, bone, slot, cw, ch, srcNode) {
    var shotIds = srcNode._slotScreenshots[slotName];
    if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
    if (shotIds.length === 0 || !qr) return;

    var saved = SMTool._saveGL(gl);

    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, pp.canvas ? pp.canvas.width : cw, pp.canvas ? pp.canvas.height : ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min((pp.canvas ? pp.canvas.height : ch) * 0.2, 250), 80);

    function _ensureTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    for (var ssi = 0; ssi < shotIds.length; ssi++) {
        var shotId = shotIds[ssi];
        if (typeof shotId !== 'number') continue;
        if (srcNode._slotShotMounted && srcNode._slotShotMounted[slotName] && srcNode._slotShotMounted[slotName][ssi] === false) continue;

        var tex = _ensureTex(shotId);
        if (!tex) continue;
        _uploadTex(shotId);

        var drawW = defSize, drawH = defSize;
        var texEntry = pp._boneTexCache[shotId];
        if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
            drawW = texEntry.img.width;
            drawH = texEntry.img.height;
        }

        var offX = ssi * 5, offY = ssi * 5;

        var model = new Float32Array(16);
        SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

        var mvp = new Float32Array(16);
        SMTool._mulM4(mvp, ortho, model);
        gl.uniformMatrix4fv(qr.uMVP, false, mvp);

        // ★ 应用 slot 的 color/blendMode
        var sc2 = (slot && slot.color) ? slot.color : null;
        gl.uniform4f(qr.uColor, sc2 ? (typeof sc2.r === 'number' ? sc2.r : 1) : 1, sc2 ? (typeof sc2.g === 'number' ? sc2.g : 1) : 1, sc2 ? (typeof sc2.b === 'number' ? sc2.b : 1) : 1, 1.0);
        gl.uniform1f(qr.uAlpha, 0.9 * (sc2 ? (typeof sc2.a === 'number' ? sc2.a : 1) : 1));
        var bm2 = (slot && slot.data && typeof slot.data.blendMode === 'number') ? slot.data.blendMode : 0;
        SMTool._applySlotBlendMode(gl, bm2);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    SMTool._restoreGL(gl, saved);
};

// ★ 层级预览专用：按 drawOrder 分段交错渲染单层骨架
SMTool._renderLayerSkeletonInterleaved = function (ls, gl, WGL, srcNode) {
    var skeleton = ls.skeleton;
    var drawOrder = skeleton.drawOrder;

    // 无自定义图片或空 drawOrder → 正常渲染
    if (!srcNode || !srcNode._slotScreenshots || !drawOrder || drawOrder.length === 0) {
        ls.shader.bind();
        ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
        ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);
        ls.batcher.begin(ls.shader);
        ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
        ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
        ls.batcher.end();
        ls.shader.unbind();
        return;
    }

    // ★ 检测骨架是否使用 Clipping（剪裁）或 Mesh（网格）附件
    // 这些附件依赖 Spine 内部连续渲染状态，分段 batcher.begin/end 会打断它们
    var SP38 = window.spine38;
    var hasClippingOrMesh = false;
    var ClipClass = SP38 && SP38.ClippingAttachment;
    var MeshClass = SP38 && SP38.MeshAttachment;
    var SkinMeshClass = SP38 && SP38.SkinnedMeshAttachment;
    if (ClipClass || MeshClass || SkinMeshClass) {
        for (var di = 0; di < drawOrder.length; di++) {
            var att = drawOrder[di].attachment;
            if (!att) continue;
            if ((ClipClass && att instanceof ClipClass) ||
                (MeshClass && att instanceof MeshClass) ||
                (SkinMeshClass && att instanceof SkinMeshClass)) {
                hasClippingOrMesh = true;
                break;
            }
        }
    }
    if (hasClippingOrMesh) {
        // 回退到正常渲染，自定义插槽图片在骨架后渲染
        ls.shader.bind();
        ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
        ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);
        ls.batcher.begin(ls.shader);
        ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
        ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
        ls.batcher.end();
        ls.shader.unbind();
        // ★ 自定义插槽图片在骨架后渲染
        SMTool._renderLayerPreviewSlotImagesForSkeleton(ls, gl, WGL, srcNode);
        return;
    }

    // 构建 drawOrder 索引映射
    var slotDrawIdx = {};
    var slotBoneMap = {};
    var slotObjMap = {};
    for (var di = 0; di < drawOrder.length; di++) {
        var sl = drawOrder[di];
        var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
        slotDrawIdx[nm] = di;
        if (sl.bone) slotBoneMap[nm] = sl.bone;
        slotObjMap[nm] = sl;
    }

    // 收集有自定义图片的 slot
    var slotNames = Object.keys(srcNode._slotScreenshots);
    var customDrawIndices = [];
    for (var sni = 0; sni < slotNames.length; sni++) {
        var sn = slotNames[sni];
        var shotIds = srcNode._slotScreenshots[sn];
        if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
        if (shotIds.length === 0) continue;
        var anyMounted = true;
        if (srcNode._slotShotMounted && srcNode._slotShotMounted[sn]) {
            anyMounted = false;
            for (var mi = 0; mi < shotIds.length; mi++) {
                if (srcNode._slotShotMounted[sn][mi] !== false) { anyMounted = true; break; }
            }
        }
        if (!anyMounted) continue;
        var idx = slotDrawIdx[sn];
        if (idx !== undefined) {
            customDrawIndices.push({ slotName: sn, drawIdx: idx, bone: slotBoneMap[sn], slot: slotObjMap[sn] });
        }
    }

    if (customDrawIndices.length === 0) {
        ls.shader.bind();
        ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
        ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);
        ls.batcher.begin(ls.shader);
        ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
        ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
        ls.batcher.end();
        ls.shader.unbind();
        return;
    }

    customDrawIndices.sort(function (a, b) { return a.drawIdx - b.drawIdx; });

    var allDrawOrder = drawOrder.slice();
    var prevEnd = 0;

    ls.shader.bind();
    ls.shader.setUniformi(WGL.Shader.SAMPLER, 0);
    ls.shader.setUniform4x4f(WGL.Shader.MVP_MATRIX, ls.mvp.values);

    // 懒初始化四边形渲染器（层级预览共用 pp._boneQR，通过 window 访问）
    // _renderLayerSkeletonInterleaved 被 SMTool._renderLayerPreview 调用，pp 在调用栈中不可直接访问
    // 此处使用独立渲染，直接构造矩阵
    for (var ci = 0; ci < customDrawIndices.length; ci++) {
        var cs = customDrawIndices[ci];
        var segEnd = cs.drawIdx + 1;

        if (segEnd > prevEnd) {
            skeleton.drawOrder = allDrawOrder.slice(prevEnd, segEnd);
            ls.batcher.begin(ls.shader);
            ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
            ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
            ls.batcher.end();
        }

        // 在 slot 的 Spine 内容之后渲染自定义图片
        if (cs.bone) {
            SMTool._renderSingleSlotImagesDirect(gl, ls, cs.slotName, cs.bone, cs.slot, srcNode);
        }

        prevEnd = segEnd;
    }

    if (prevEnd < allDrawOrder.length) {
        skeleton.drawOrder = allDrawOrder.slice(prevEnd);
        ls.batcher.begin(ls.shader);
        ls.skeletonRenderer.premultipliedAlpha = ls.premultipliedAlpha;
        ls.skeletonRenderer.draw(ls.batcher, ls.skeleton);
        ls.batcher.end();
    }

    skeleton.drawOrder = allDrawOrder;
    ls.shader.unbind();
};

// ★ 层级预览场景：直接用 GL 原生调用渲染单个 slot 的图片
SMTool._renderSingleSlotImagesDirect = function (gl, ls, slotName, bone, slot, srcNode) {
    var shotIds = srcNode._slotScreenshots[slotName];
    if (!Array.isArray(shotIds)) shotIds = shotIds ? [shotIds] : [];
    if (shotIds.length === 0) return;

    // 懒初始化：本函数可能被多次调用，使用简单的缓存
    if (!SMTool._layerSlotQR && gl) {
        SMTool._layerSlotQR = SMTool._createBoneQuadRenderer(gl);
        SMTool._layerSlotTexCache = {};
    }
    var qr = SMTool._layerSlotQR;
    var texCache = SMTool._layerSlotTexCache;
    if (!qr) return;

    var saved = SMTool._saveGL(gl);
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    // 使用简单正交投影（与层级预览的 mvp 一致）
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, 0, 1, 0, 1, -1, 1); // 临时，会被 bone matrix 覆盖
    gl.uniform1i(qr.uTex, 0);

    var defSize = 150;

    function _ensureTex(shotId) {
        if (texCache[shotId]) return texCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        texCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }
    function _uploadTex(shotId) {
        var entry = texCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    for (var ssi = 0; ssi < shotIds.length; ssi++) {
        var shotId = shotIds[ssi];
        if (typeof shotId !== 'number') continue;
        if (srcNode._slotShotMounted && srcNode._slotShotMounted[slotName] && srcNode._slotShotMounted[slotName][ssi] === false) continue;

        var tex = _ensureTex(shotId);
        if (!tex) continue;
        _uploadTex(shotId);

        var drawW = defSize, drawH = defSize;
        var texEntry = texCache[shotId];
        if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
            drawW = texEntry.img.width;
            drawH = texEntry.img.height;
        }
        var offX = ssi * 5, offY = ssi * 5;

        var model = new Float32Array(16);
        SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

        // 使用 MVP 矩阵（包含正视投影）
        var mvp = new Float32Array(16);
        SMTool._mulM4(mvp, ls.mvp.values, model);
        gl.uniformMatrix4fv(qr.uMVP, false, mvp);

        // ★ 应用 slot 的 color/blendMode
        var sc3 = (slot && slot.color) ? slot.color : null;
        gl.uniform4f(qr.uColor, sc3 ? (typeof sc3.r === 'number' ? sc3.r : 1) : 1, sc3 ? (typeof sc3.g === 'number' ? sc3.g : 1) : 1, sc3 ? (typeof sc3.b === 'number' ? sc3.b : 1) : 1, 1.0);
        gl.uniform1f(qr.uAlpha, 0.9 * (sc3 ? (typeof sc3.a === 'number' ? sc3.a : 1) : 1));
        var bm3 = (slot && slot.data && typeof slot.data.blendMode === 'number') ? slot.data.blendMode : 0;
        SMTool._applySlotBlendMode(gl, bm3);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    SMTool._restoreGL(gl, saved);
};

// ★ 回退渲染：为使用 Clipping/Mesh 的骨架渲染插槽图片（在骨架之后，不分段）
SMTool._renderLayerPreviewSlotImagesForSkeleton = function (ls, gl, WGL, srcNode) {
    if (!srcNode || !srcNode._slotScreenshots || !ls.skeleton) return;
    var skeleton = ls.skeleton;
    var slotNames = Object.keys(srcNode._slotScreenshots);
    if (slotNames.length === 0) return;

    var qr = SMTool._layerSlotQR;
    if (!qr && gl) { SMTool._layerSlotQR = SMTool._createBoneQuadRenderer(gl); qr = SMTool._layerSlotQR; }
    if (!qr) return;

    // Build slot → bone map
    var slotBoneMap = {};
    var slotObjMap = {};
    var slots = skeleton.slots;
    if (slots) {
        for (var i = 0; i < slots.length; i++) {
            var nm = (slots[i].data && slots[i].data.name) ? slots[i].data.name : '';
            if (nm && slots[i].bone) { slotBoneMap[nm] = slots[i].bone; slotObjMap[nm] = slots[i]; }
        }
    }

    for (var sni = 0; sni < slotNames.length; sni++) {
        var sn = slotNames[sni];
        var bone = slotBoneMap[sn];
        if (!bone) continue;
        var slot = slotObjMap[sn];
        SMTool._renderSingleSlotImagesDirect(gl, ls, sn, bone, slot, srcNode);
    }
};

// ================================================================
// 渲染节点骨骼挂图（在共享画布上，跟随 Spine 骨骼动画）
// 调用时机：每帧每个节点骨架渲染完成后
// ================================================================
SMTool._renderNodeBoneImages = function (node, gl, nodeW, nodeH, sx, glY, sw, sh) {
    if (!node._boneScreenshots || !node.skeleton) return;
    var boneNames = Object.keys(node._boneScreenshots);
    if (boneNames.length === 0) return;

    // 懒初始化骨骼四边形渲染器（主画布共享）
    if (!SMTool._boneQR && gl) {
        SMTool._boneQR = SMTool._createBoneQuadRenderer(gl);
    }
    var qr = SMTool._boneQR;
    if (!qr) return;

    // ★ 显式恢复节点专属 viewport + scissor（4.x SceneRenderer.end() 可能重置）
    gl.viewport(sx, glY, sw, sh);
    gl.scissor(sx, glY, sw, sh);
    gl.enable(gl.SCISSOR_TEST);

    // 构建骨骼名 → 骨骼对象映射
    var bones = node.skeleton.bones;
    if (!bones || bones.length === 0) return;
    var boneMap = {};
    for (var i = 0; i < bones.length; i++) {
        var b = bones[i];
        var nm = (b.data && b.data.name) ? b.data.name : (typeof b.getName === 'function' ? b.getName() : '');
        if (nm) boneMap[nm] = b;
    }

    // 保存 GL 状态
    var saved = SMTool._saveGL(gl);

    // 设置骨骼挂图渲染管线
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    // 正交投影：映射节点画布坐标（Y-up，匹配 Spine 坐标系）
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, 0, nodeW, 0, nodeH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(nodeH * 0.2, 250), 80); // 画布高度的 20%（80-250px）

    for (var bi = 0; bi < boneNames.length; bi++) {
        var boneName = boneNames[bi];
        var bone = boneMap[boneName];
        if (!bone) continue;

        var shotIds = node._boneScreenshots[boneName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        // ★ 骨骼 worldX/Y 已含 skeleton x/y 偏移，无需额外加

        for (var si = 0; si < shotIds.length; si++) {
            var shotId = shotIds[si];
            if (typeof shotId !== 'number') continue;
            // ★ 检查挂载状态：false 则不渲染（性能优化）
            if (node._boneShotMounted && node._boneShotMounted[boneName] && node._boneShotMounted[boneName][si] === false) continue;

            var tex = SMTool._ensureBoneTexture(gl, shotId);
            if (!tex) continue;
            SMTool._uploadBoneTexture(gl, shotId);

            // 图片原始像素尺寸 = 100% 大小
            var drawW = defSize, drawH = defSize;
            var texEntry = SMTool._boneTexCache[shotId];
            if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
                drawW = texEntry.img.width;
                drawH = texEntry.img.height;
            }

            // 同一骨骼多张图微偏移，避免完全重叠
            var offX = si * 5;
            var offY = si * 5;

            // ★ 直接使用骨骼矩阵分量构建模型矩阵，旋转方向 100% 与骨骼一致
            var model = new Float32Array(16);
            SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

            var mvp = new Float32Array(16);
            SMTool._mulM4(mvp, ortho, model);
            gl.uniformMatrix4fv(qr.uMVP, false, mvp);
            gl.uniform1f(qr.uAlpha, 0.9);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    // 恢复 GL 状态
    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染节点插槽挂图（在共享画布上，跟随 Spine 插槽所属骨骼动画）
// 与 _renderNodeBoneImages 并行，数据源为 node._slotScreenshots
// ★ 按 Spine drawOrder 排序渲染，确保插槽图片层级正确
// passFilter: 'bottom' 只渲染底层（骨架前调用）, 'top' 只渲染顶层（骨架后调用）, 其他=全部
// ================================================================
SMTool._renderNodeSlotImages = function (node, gl, nodeW, nodeH, sx, glY, sw, sh, passFilter) {
    if (!node._slotScreenshots || !node.skeleton) return;
    var slotNames = Object.keys(node._slotScreenshots);
    if (slotNames.length === 0) return;

    // 懒初始化四边形渲染器（与骨骼共用）
    if (!SMTool._boneQR && gl) {
        SMTool._boneQR = SMTool._createBoneQuadRenderer(gl);
    }
    var qr = SMTool._boneQR;
    if (!qr) return;

    // ★ 显式恢复节点专属 viewport + scissor
    gl.viewport(sx, glY, sw, sh);
    gl.scissor(sx, glY, sw, sh);
    gl.enable(gl.SCISSOR_TEST);

    // 构建插槽名 → 骨骼对象映射（通过插槽的 bone 属性）
    var slots = node.skeleton.slots;
    if (!slots || slots.length === 0) return;
    var slotBoneMap = {};
    var slotDrawOrderMap = {}; // ★ 插槽名 → drawOrder 中的索引（0=最先绘制/最底层）
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
        if (nm && sl.bone) slotBoneMap[nm] = sl.bone;
    }
    // ★ 构建 drawOrder 索引映射：drawOrder 是排序好的 Slot 数组，索引越小越底层
    var drawOrder = node.skeleton.drawOrder;
    if (drawOrder && drawOrder.length > 0) {
        for (var di = 0; di < drawOrder.length; di++) {
            var dsl = drawOrder[di];
            var dnm = (dsl.data && dsl.data.name) ? dsl.data.name : (typeof dsl.getName === 'function' ? dsl.getName() : '');
            if (dnm) slotDrawOrderMap[dnm] = di;
        }
    }
    // 未在 drawOrder 中的插槽放到最底层（索引 -1）
    for (var sni = 0; sni < slotNames.length; sni++) {
        if (!(slotNames[sni] in slotDrawOrderMap)) slotDrawOrderMap[slotNames[sni]] = -1;
    }

    // ★ 收集所有待渲染的插槽图片条目，并按 drawOrder 排序
    var slotEntries = [];
    for (var si = 0; si < slotNames.length; si++) {
        var slotName = slotNames[si];
        var bone = slotBoneMap[slotName];
        if (!bone) continue;

        var shotIds = node._slotScreenshots[slotName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        // ★ 预提取骨骼矩阵分量（a/b/c/d → 旋转+缩放, worldX/Y → 位置）
        var boneA, boneB, boneC, boneD, boneWX, boneWY;
        if (typeof bone.a === 'number' && typeof bone.b === 'number' && typeof bone.c === 'number' && typeof bone.d === 'number') {
            // 3.8 / 4.x 均可能暴露 a/b/c/d 属性
            boneA = bone.a; boneB = bone.b; boneC = bone.c; boneD = bone.d;
            boneWX = (typeof bone.worldX === 'number') ? bone.worldX : (typeof bone.getWorldX === 'function' ? bone.getWorldX() : 0);
            boneWY = (typeof bone.worldY === 'number') ? bone.worldY : (typeof bone.getWorldY === 'function' ? bone.getWorldY() : 0);
        } else {
            var bx2, by2, angle2, sx2, sy2;
            if (typeof bone.getWorldX === 'function') {
                bx2 = bone.getWorldX(); by2 = bone.getWorldY();
                angle2 = (typeof bone.getWorldRotationX === 'function') ? (bone.getWorldRotationX() * Math.PI / 180) : 0;
                sx2 = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
                sy2 = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
            } else {
                bx2 = bone.worldX; by2 = bone.worldY;
                angle2 = Math.atan2(bone.b, bone.a);
                sx2 = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
                sy2 = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
            }
            var cos2 = Math.cos(angle2), sin2 = Math.sin(angle2);
            boneA = cos2 * sx2; boneB = sin2 * sx2; boneC = -sin2 * sy2; boneD = cos2 * sy2;
            boneWX = bx2; boneWY = by2;
        }

        for (var ssi = 0; ssi < shotIds.length; ssi++) {
            var shotId = shotIds[ssi];
            if (typeof shotId !== 'number') continue;
            if (node._slotShotMounted && node._slotShotMounted[slotName] && node._slotShotMounted[slotName][ssi] === false) continue;

            slotEntries.push({
                drawOrderIdx: slotDrawOrderMap[slotName],
                slotName: slotName,
                shotIdx: ssi,
                shotId: shotId,
                boneA: boneA, boneB: boneB, boneC: boneC, boneD: boneD,
                bx: boneWX, by: boneWY
            });
        }
    }

    if (slotEntries.length === 0) { SMTool._restoreGL(gl, SMTool._saveGL(gl)); return; }

    // ★ 按 drawOrder 索引升序排序（索引越小越底层，先渲染）
    slotEntries.sort(function (a, b) { return a.drawOrderIdx - b.drawOrderIdx; });

    // ★ 分 pass 过滤：按 drawOrder 中位数分底层/顶层两组
    // 底层组（drawOrderIdx <= median）在骨架前渲染，顶层组在骨架后渲染
    // 这样插槽图片就不会全部浮在骨架上方
    if (passFilter === 'bottom' || passFilter === 'top') {
        var midIdx = Math.floor((slotEntries.length - 1) / 2);
        var medianOrder = slotEntries[midIdx].drawOrderIdx;
        var filtered = [];
        for (var fe = 0; fe < slotEntries.length; fe++) {
            var inBottom = slotEntries[fe].drawOrderIdx <= medianOrder;
            if ((passFilter === 'bottom' && inBottom) || (passFilter === 'top' && !inBottom)) {
                filtered.push(slotEntries[fe]);
            }
        }
        slotEntries = filtered;
    }
    if (slotEntries.length === 0) { SMTool._restoreGL(gl, SMTool._saveGL(gl)); return; }

    // 保存 GL 状态
    var saved = SMTool._saveGL(gl);

    // 设置四边形渲染管线
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    // 正交投影
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, 0, nodeW, 0, nodeH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(nodeH * 0.2, 250), 80);

    // ★ 按排序后的顺序渲染
    for (var ei = 0; ei < slotEntries.length; ei++) {
        var entry = slotEntries[ei];
        var tex = SMTool._ensureBoneTexture(gl, entry.shotId);
        if (!tex) continue;
        SMTool._uploadBoneTexture(gl, entry.shotId);

        var drawW = defSize, drawH = defSize;
        var texEntry = SMTool._boneTexCache[entry.shotId];
        if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
            drawW = texEntry.img.width;
            drawH = texEntry.img.height;
        }

        var offX = entry.shotIdx * 5;
        var offY = entry.shotIdx * 5;

        // ★ 直接使用预提取的骨骼矩阵分量构建模型矩阵
        var model = new Float32Array(16);
        model.fill(0);
        model[0] = entry.boneA * drawW;
        model[1] = entry.boneB * drawW;
        model[4] = entry.boneC * drawH;
        model[5] = entry.boneD * drawH;
        model[12] = entry.bx + offX;
        model[13] = entry.by + offY;
        model[10] = 1;
        model[15] = 1;

        var mvp = new Float32Array(16);
        SMTool._mulM4(mvp, ortho, model);
        gl.uniformMatrix4fv(qr.uMVP, false, mvp);
        gl.uniform1f(qr.uAlpha, 0.9);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 恢复 GL 状态
    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染层级预览浮窗骨骼挂图（所有层的所有链骨架）
// ================================================================
SMTool._renderLayerPreviewBoneImages = function (pp) {
    if (!pp || !pp.visible || !pp.gl) return;
    var list = pp._layerSkeletons;
    if (!list || list.length === 0) return;

    var gl = pp.gl;
    var cw = pp._canvasWidth || (pp.canvas ? pp.canvas.width : 320);
    var ch = pp._canvasHeight || (pp.canvas ? pp.canvas.height : 500);

    // 懒初始化四边形渲染器（与单节点预览共用缓存的渲染器）
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {};
    }
    var qr = pp._boneQR;
    if (!qr) return;

    var saved = SMTool._saveGL(gl);
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, cw, ch);

    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(ch * 0.2, 250), 80);

    function _ensureLayerTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadLayerTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    // ★★ 递归渲染函数：处理一层（含嵌套子层）的所有骨架挂点图片
    var _renderSkeletonBoneImages = function (layerEntry) {
        // 获取当前活跃的链骨架
        var activeIdx = (layerEntry._chainSkeletons && layerEntry._chainSkeletons.length > 0) ? (layerEntry._chainIdx || 0) : -1;
        var skeletons = (activeIdx >= 0 && layerEntry._chainSkeletons) ? [layerEntry._chainSkeletons[activeIdx]] : (!layerEntry._chainSkeletons ? [layerEntry] : []);
        for (var ski = 0; ski < skeletons.length; ski++) {
            var skEntry = skeletons[ski];
            if (!skEntry || !skEntry.skeleton) continue;
            skEntry.skeleton.updateWorldTransform(skEntry.physParam);
            var srcNode = SMData.nodes.get(skEntry._chainNodeId || skEntry.nodeId);
            if (!srcNode || !srcNode._boneScreenshots) continue;
            var boneNames = Object.keys(srcNode._boneScreenshots);
            if (boneNames.length === 0) continue;

            var bones = skEntry.skeleton.bones;
            if (!bones || bones.length === 0) continue;
            var boneMap = {};
            for (var bi = 0; bi < bones.length; bi++) {
                var b = bones[bi];
                var nm = (b.data && b.data.name) ? b.data.name : (typeof b.getName === 'function' ? b.getName() : '');
                if (nm) boneMap[nm] = b;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
            gl.enableVertexAttribArray(qr.aPos);
            gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(qr.aUV);
            gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

            for (var bni = 0; bni < boneNames.length; bni++) {
                var boneName = boneNames[bni];
                var bone = boneMap[boneName];
                if (!bone) continue;

                var shotIds = srcNode._boneScreenshots[boneName];
                if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
                if (shotIds.length === 0) continue;

                for (var si = 0; si < shotIds.length; si++) {
                    var shotId = shotIds[si];
                    if (typeof shotId !== 'number') continue;
                    var tex = _ensureLayerTex(shotId);
                    if (!tex) continue;
                    _uploadLayerTex(shotId);

                    var drawW = defSize, drawH = defSize;
                    var entry = pp._boneTexCache[shotId];
                    if (entry && entry.img && entry.img.width && entry.img.height) {
                        drawW = entry.img.width; drawH = entry.img.height;
                    }
                    var offX = si * 5, offY = si * 5;

                    var model = new Float32Array(16);
                    SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

                    var mvp = new Float32Array(16);
                    SMTool._mulM4(mvp, ortho, model);
                    gl.uniformMatrix4fv(qr.uMVP, false, mvp);
                    gl.uniform1f(qr.uAlpha, 0.9);

                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, tex);
                    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                }
            }
        }

        // ★★ 递归渲染嵌套子层的挂点图片（支持 A→B→C 任意深度）
        if (layerEntry._nestedSubActive && layerEntry._nestedLayerSkeletons) {
            for (var ni = 0; ni < layerEntry._nestedLayerSkeletons.length; ni++) {
                _renderSkeletonBoneImages(layerEntry._nestedLayerSkeletons[ni]);
            }
        }
    };

    // ★ 遍历所有根层，递归渲染挂点图片
    for (var li = 0; li < list.length; li++) {
        _renderSkeletonBoneImages(list[li]);
    }

    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染预览浮窗骨骼挂图（预览独立 WebGL 上下文）
// ================================================================
SMTool._renderPreviewBoneImages = function (pp) {
    if (!pp || !pp.visible || !pp.skeleton || !pp.gl) return;
    var nodeId = pp.nodeId;
    if (nodeId == null) return;
    var srcNode = SMData.nodes.get(nodeId);
    if (!srcNode || !srcNode._boneScreenshots) return;
    var boneNames = Object.keys(srcNode._boneScreenshots);
    if (boneNames.length === 0) return;

    var gl = pp.gl;
    var cw = pp._canvasWidth || (pp.canvas ? pp.canvas.width : 320);
    var ch = pp._canvasHeight || (pp.canvas ? pp.canvas.height : 500);

    // 懒初始化预览专属四边形渲染器
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {}; // 预览专属纹理缓存
    }
    var qr = pp._boneQR;
    if (!qr) return;

    // 构建骨骼映射
    var bones = pp.skeleton.bones;
    if (!bones || bones.length === 0) return;
    var boneMap = {};
    for (var i = 0; i < bones.length; i++) {
        var b = bones[i];
        var nm = (b.data && b.data.name) ? b.data.name : (typeof b.getName === 'function' ? b.getName() : '');
        if (nm) boneMap[nm] = b;
    }

    var saved = SMTool._saveGL(gl);

    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    // ★ 显式恢复预览专属 viewport（4.x SceneRenderer.end() 可能重置）
    gl.viewport(0, 0, pp.canvas ? pp.canvas.width : cw, pp.canvas ? pp.canvas.height : ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    var ortho = new Float32Array(16);
    // ★ 预览缩放适配：正交投影范围与 Spine 预览渲染一致
    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min((pp.canvas ? pp.canvas.height : ch) * 0.2, 250), 80); // 画布高度的 20%（80-250px）

    // 预览专属纹理辅助（复用主缓存的数据，但在预览 GL 上下文中创建纹理）
    function _ensurePreviewTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadPreviewTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    for (var bi = 0; bi < boneNames.length; bi++) {
        var boneName = boneNames[bi];
        var bone = boneMap[boneName];
        if (!bone) continue;

        var shotIds = srcNode._boneScreenshots[boneName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        for (var si = 0; si < shotIds.length; si++) {
            var shotId = shotIds[si];
            if (typeof shotId !== 'number') continue;

            var tex = _ensurePreviewTex(shotId);
            if (!tex) continue;
            _uploadPreviewTex(shotId);

            var drawW = defSize, drawH = defSize;
            var entry = pp._boneTexCache[shotId];
            if (entry && entry.img && entry.img.width && entry.img.height) {
                drawW = entry.img.width;
                drawH = entry.img.height;
            }

            var offX = si * 5;
            var offY = si * 5;

            // ★ 直接使用骨骼矩阵分量构建模型矩阵
            var model = new Float32Array(16);
            SMTool._boneM4(model, bone, offX, offY, drawW, drawH);

            var mvp = new Float32Array(16);
            SMTool._mulM4(mvp, ortho, model);
            gl.uniformMatrix4fv(qr.uMVP, false, mvp);
            gl.uniform1f(qr.uAlpha, 0.9);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
    }

    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染预览浮窗插槽挂图（预览独立 WebGL 上下文）
// 与 _renderPreviewBoneImages 并行，数据源为 srcNode._slotScreenshots
// ★ 按 Spine drawOrder 排序渲染，确保插槽图片层级正确
// passFilter: 'bottom' | 'top' | 其他=全部
// ================================================================
SMTool._renderPreviewSlotImages = function (pp, passFilter) {
    if (!pp || !pp.visible || !pp.skeleton || !pp.gl) return;
    var nodeId = pp.nodeId;
    if (nodeId == null) return;
    var srcNode = SMData.nodes.get(nodeId);
    if (!srcNode || !srcNode._slotScreenshots) return;
    var slotNames = Object.keys(srcNode._slotScreenshots);
    if (slotNames.length === 0) return;

    var gl = pp.gl;
    var cw = pp._canvasWidth || (pp.canvas ? pp.canvas.width : 320);
    var ch = pp._canvasHeight || (pp.canvas ? pp.canvas.height : 500);

    // 懒初始化预览专属四边形渲染器（与骨骼共用）
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {};
    }
    var qr = pp._boneQR;
    if (!qr) return;

    // 构建插槽名 → 骨骼映射 + drawOrder 索引映射
    var slots = pp.skeleton.slots;
    if (!slots || slots.length === 0) return;
    var slotBoneMap = {};
    var slotDrawOrderMap = {}; // ★ 插槽名 → drawOrder 索引
    for (var i = 0; i < slots.length; i++) {
        var sl = slots[i];
        var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
        if (nm && sl.bone) slotBoneMap[nm] = sl.bone;
    }
    var drawOrder = pp.skeleton.drawOrder;
    if (drawOrder && drawOrder.length > 0) {
        for (var di = 0; di < drawOrder.length; di++) {
            var dsl = drawOrder[di];
            var dnm = (dsl.data && dsl.data.name) ? dsl.data.name : (typeof dsl.getName === 'function' ? dsl.getName() : '');
            if (dnm) slotDrawOrderMap[dnm] = di;
        }
    }
    for (var sni = 0; sni < slotNames.length; sni++) {
        if (!(slotNames[sni] in slotDrawOrderMap)) slotDrawOrderMap[slotNames[sni]] = -1;
    }

    // ★ 收集并排序
    var slotEntries = [];
    for (var si = 0; si < slotNames.length; si++) {
        var slotName = slotNames[si];
        var bone = slotBoneMap[slotName];
        if (!bone) continue;

        var shotIds = srcNode._slotScreenshots[slotName];
        if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
        if (shotIds.length === 0) continue;

        // ★ 预提取骨骼矩阵分量
        var boneA, boneB, boneC, boneD, boneWX, boneWY;
        if (typeof bone.a === 'number' && typeof bone.b === 'number' && typeof bone.c === 'number' && typeof bone.d === 'number') {
            boneA = bone.a; boneB = bone.b; boneC = bone.c; boneD = bone.d;
            boneWX = (typeof bone.worldX === 'number') ? bone.worldX : (typeof bone.getWorldX === 'function' ? bone.getWorldX() : 0);
            boneWY = (typeof bone.worldY === 'number') ? bone.worldY : (typeof bone.getWorldY === 'function' ? bone.getWorldY() : 0);
        } else {
            var _bx, _by, _angle, _sx, _sy;
            if (typeof bone.getWorldX === 'function') {
                _bx = bone.getWorldX(); _by = bone.getWorldY();
                _angle = (typeof bone.getWorldRotationX === 'function') ? (bone.getWorldRotationX() * Math.PI / 180) : 0;
                _sx = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
                _sy = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
            } else {
                _bx = bone.worldX; _by = bone.worldY;
                _angle = Math.atan2(bone.b, bone.a);
                _sx = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
                _sy = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
            }
            var _cos = Math.cos(_angle), _sin = Math.sin(_angle);
            boneA = _cos * _sx; boneB = _sin * _sx; boneC = -_sin * _sy; boneD = _cos * _sy;
            boneWX = _bx; boneWY = _by;
        }

        for (var ssi = 0; ssi < shotIds.length; ssi++) {
            var shotId = shotIds[ssi];
            if (typeof shotId !== 'number') continue;
            if (srcNode._slotShotMounted && srcNode._slotShotMounted[slotName] && srcNode._slotShotMounted[slotName][ssi] === false) continue;

            slotEntries.push({
                drawOrderIdx: slotDrawOrderMap[slotName],
                shotIdx: ssi,
                shotId: shotId,
                boneA: boneA, boneB: boneB, boneC: boneC, boneD: boneD,
                bx: boneWX, by: boneWY
            });
        }
    }

    if (slotEntries.length === 0) return;
    slotEntries.sort(function (a, b) { return a.drawOrderIdx - b.drawOrderIdx; });

    // ★ 分 pass 过滤：按 drawOrder 中位数分底层/顶层两组
    if (passFilter === 'bottom' || passFilter === 'top') {
        var midIdx = Math.floor((slotEntries.length - 1) / 2);
        var medianOrder = slotEntries[midIdx].drawOrderIdx;
        var filtered = [];
        for (var fe = 0; fe < slotEntries.length; fe++) {
            var inBottom = slotEntries[fe].drawOrderIdx <= medianOrder;
            if ((passFilter === 'bottom' && inBottom) || (passFilter === 'top' && !inBottom)) {
                filtered.push(slotEntries[fe]);
            }
        }
        slotEntries = filtered;
    }
    if (slotEntries.length === 0) return;

    var saved = SMTool._saveGL(gl);

    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, pp.canvas ? pp.canvas.width : cw, pp.canvas ? pp.canvas.height : ch);
    gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
    gl.enableVertexAttribArray(qr.aPos);
    gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(qr.aUV);
    gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

    var ortho = new Float32Array(16);
    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min((pp.canvas ? pp.canvas.height : ch) * 0.2, 250), 80);

    // 复用预览专属纹理辅助（与 _renderPreviewBoneImages 共享 _boneTexCache）
    function _ensurePreviewSlotTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadPreviewSlotTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    // ★ 按排序后的顺序渲染
    for (var ei = 0; ei < slotEntries.length; ei++) {
        var entry = slotEntries[ei];
        var tex = _ensurePreviewSlotTex(entry.shotId);
        if (!tex) continue;
        _uploadPreviewSlotTex(entry.shotId);

        var drawW = defSize, drawH = defSize;
        var texEntry = pp._boneTexCache[entry.shotId];
        if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
            drawW = texEntry.img.width;
            drawH = texEntry.img.height;
        }

        var offX = entry.shotIdx * 5;
        var offY = entry.shotIdx * 5;

        // ★ 直接使用预提取的骨骼矩阵分量构建模型矩阵
        var model = new Float32Array(16);
        model.fill(0);
        model[0] = entry.boneA * drawW;
        model[1] = entry.boneB * drawW;
        model[4] = entry.boneC * drawH;
        model[5] = entry.boneD * drawH;
        model[12] = entry.bx + offX;
        model[13] = entry.by + offY;
        model[10] = 1;
        model[15] = 1;

        var mvp = new Float32Array(16);
        SMTool._mulM4(mvp, ortho, model);
        gl.uniformMatrix4fv(qr.uMVP, false, mvp);
        gl.uniform1f(qr.uAlpha, 0.9);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    SMTool._restoreGL(gl, saved);
};

// ================================================================
// 渲染层级预览浮窗插槽挂图（所有层的所有链骨架）
// 与 _renderLayerPreviewBoneImages 并行，数据源为 srcNode._slotScreenshots
// ★ 按 Spine drawOrder 排序渲染，确保插槽图片层级正确
// passFilter: 'bottom' | 'top' | 其他=全部
// ================================================================
SMTool._renderLayerPreviewSlotImages = function (pp, passFilter) {
    if (!pp || !pp.visible || !pp.gl) return;
    var list = pp._layerSkeletons;
    if (!list || list.length === 0) return;

    var gl = pp.gl;
    var cw = pp._canvasWidth || (pp.canvas ? pp.canvas.width : 320);
    var ch = pp._canvasHeight || (pp.canvas ? pp.canvas.height : 500);

    // 懒初始化四边形渲染器（与骨骼共用）
    if (!pp._boneQR) {
        pp._boneQR = SMTool._createBoneQuadRenderer(gl);
        pp._boneTexCache = {};
    }
    var qr = pp._boneQR;
    if (!qr) return;

    var saved = SMTool._saveGL(gl);
    gl.useProgram(qr.prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, cw, ch);

    var zoom = pp._contentZoom || 1.0;
    var halfW = cw / (2 * zoom);
    var halfH = ch / (2 * zoom);
    var ortho = new Float32Array(16);
    SMTool._orthoM4(ortho, cw / 2 - halfW, cw / 2 + halfW, ch / 2 - halfH, ch / 2 + halfH, -1, 1);
    gl.uniform1i(qr.uTex, 0);

    var defSize = Math.max(Math.min(ch * 0.2, 250), 80);

    // ★ 复用层次预览纹理辅助（与 _renderLayerPreviewBoneImages 共享缓存）
    function _ensureLayerSlotTex(shotId) {
        if (pp._boneTexCache[shotId]) return pp._boneTexCache[shotId].texture;
        var dataUrl = SMData._shotGetDataUrl ? SMData._shotGetDataUrl(shotId) : null;
        if (!dataUrl) return null;
        var img = new Image();
        img.src = dataUrl;
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        var entry = { texture: tex, img: img, uploaded: false };
        pp._boneTexCache[shotId] = entry;
        img.onload = function () { entry.uploaded = false; };
        return tex;
    }

    function _uploadLayerSlotTex(shotId) {
        var entry = pp._boneTexCache[shotId];
        if (!entry || entry.uploaded || !entry.img || !entry.img.complete || !entry.img.width) return;
        try {
            gl.bindTexture(gl.TEXTURE_2D, entry.texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.img);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.uploaded = true;
        } catch (e) {}
    }

    // 遍历所有层
    for (var li = 0; li < list.length; li++) {
        var ls = list[li];
        var activeIdx = (ls._chainSkeletons && ls._chainSkeletons.length > 0) ? (ls._chainIdx || 0) : -1;
        var skeletons = (activeIdx >= 0 && ls._chainSkeletons) ? [ls._chainSkeletons[activeIdx]] : (!ls._chainSkeletons ? [ls] : []);
        for (var ski = 0; ski < skeletons.length; ski++) {
            var skEntry = skeletons[ski];
            if (!skEntry || !skEntry.skeleton) continue;
            skEntry.skeleton.updateWorldTransform(skEntry.physParam);
            var srcNode = SMData.nodes.get(skEntry._chainNodeId || skEntry.nodeId);
            if (!srcNode || !srcNode._slotScreenshots) continue;
            var slotNames = Object.keys(srcNode._slotScreenshots);
            if (slotNames.length === 0) continue;

            var slots = skEntry.skeleton.slots;
            if (!slots || slots.length === 0) continue;
            var slotBoneMap = {};
            var slotDrawOrderMap = {}; // ★ 插槽名 → drawOrder 索引
            for (var sli = 0; sli < slots.length; sli++) {
                var sl = slots[sli];
                var nm = (sl.data && sl.data.name) ? sl.data.name : (typeof sl.getName === 'function' ? sl.getName() : '');
                if (nm && sl.bone) slotBoneMap[nm] = sl.bone;
            }
            var drawOrder = skEntry.skeleton.drawOrder;
            if (drawOrder && drawOrder.length > 0) {
                for (var di = 0; di < drawOrder.length; di++) {
                    var dsl = drawOrder[di];
                    var dnm = (dsl.data && dsl.data.name) ? dsl.data.name : (typeof dsl.getName === 'function' ? dsl.getName() : '');
                    if (dnm) slotDrawOrderMap[dnm] = di;
                }
            }
            for (var sni = 0; sni < slotNames.length; sni++) {
                if (!(slotNames[sni] in slotDrawOrderMap)) slotDrawOrderMap[slotNames[sni]] = -1;
            }

            // ★ 收集并排序
            var slotEntries = [];
            for (var si = 0; si < slotNames.length; si++) {
                var slotName = slotNames[si];
                var bone = slotBoneMap[slotName];
                if (!bone) continue;

                var shotIds = srcNode._slotScreenshots[slotName];
                if (!Array.isArray(shotIds)) shotIds = shotIds != null ? [shotIds] : [];
                if (shotIds.length === 0) continue;

                // ★ 预提取骨骼矩阵分量
                var boneA, boneB, boneC, boneD, boneWX, boneWY;
                if (typeof bone.a === 'number' && typeof bone.b === 'number' && typeof bone.c === 'number' && typeof bone.d === 'number') {
                    boneA = bone.a; boneB = bone.b; boneC = bone.c; boneD = bone.d;
                    boneWX = (typeof bone.worldX === 'number') ? bone.worldX : (typeof bone.getWorldX === 'function' ? bone.getWorldX() : 0);
                    boneWY = (typeof bone.worldY === 'number') ? bone.worldY : (typeof bone.getWorldY === 'function' ? bone.getWorldY() : 0);
                } else {
                    var _bx2, _by2, _angle2, _sx2, _sy2;
                    if (typeof bone.getWorldX === 'function') {
                        _bx2 = bone.getWorldX(); _by2 = bone.getWorldY();
                        _angle2 = (typeof bone.getWorldRotationX === 'function') ? (bone.getWorldRotationX() * Math.PI / 180) : 0;
                        _sx2 = (typeof bone.getWorldScaleX === 'function') ? bone.getWorldScaleX() : 1;
                        _sy2 = (typeof bone.getWorldScaleY === 'function') ? bone.getWorldScaleY() : 1;
                    } else {
                        _bx2 = bone.worldX; _by2 = bone.worldY;
                        _angle2 = Math.atan2(bone.b, bone.a);
                        _sx2 = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
                        _sy2 = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
                    }
                    var _cos2 = Math.cos(_angle2), _sin2 = Math.sin(_angle2);
                    boneA = _cos2 * _sx2; boneB = _sin2 * _sx2; boneC = -_sin2 * _sy2; boneD = _cos2 * _sy2;
                    boneWX = _bx2; boneWY = _by2;
                }

                for (var ssi = 0; ssi < shotIds.length; ssi++) {
                    var shotId = shotIds[ssi];
                    if (typeof shotId !== 'number') continue;
                    if (srcNode._slotShotMounted && srcNode._slotShotMounted[slotName] && srcNode._slotShotMounted[slotName][ssi] === false) continue;

                    slotEntries.push({
                        drawOrderIdx: slotDrawOrderMap[slotName],
                        shotIdx: ssi,
                        shotId: shotId,
                        boneA: boneA, boneB: boneB, boneC: boneC, boneD: boneD,
                        bx: boneWX, by: boneWY
                    });
                }
            }

            if (slotEntries.length === 0) continue;
            slotEntries.sort(function (a, b) { return a.drawOrderIdx - b.drawOrderIdx; });

            // ★ 分 pass 过滤：按 drawOrder 中位数分底层/顶层两组
            if (passFilter === 'bottom' || passFilter === 'top') {
                var lyrMidIdx = Math.floor((slotEntries.length - 1) / 2);
                var lyrMedianOrder = slotEntries[lyrMidIdx].drawOrderIdx;
                var lyrFiltered = [];
                for (var lfe = 0; lfe < slotEntries.length; lfe++) {
                    var lyrInBottom = slotEntries[lfe].drawOrderIdx <= lyrMedianOrder;
                    if ((passFilter === 'bottom' && lyrInBottom) || (passFilter === 'top' && !lyrInBottom)) {
                        lyrFiltered.push(slotEntries[lfe]);
                    }
                }
                slotEntries = lyrFiltered;
            }
            if (slotEntries.length === 0) continue;

            gl.bindBuffer(gl.ARRAY_BUFFER, qr.vbo);
            gl.enableVertexAttribArray(qr.aPos);
            gl.vertexAttribPointer(qr.aPos, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(qr.aUV);
            gl.vertexAttribPointer(qr.aUV, 2, gl.FLOAT, false, 16, 8);

            // ★ 按排序后的顺序渲染
            for (var ei = 0; ei < slotEntries.length; ei++) {
                var entry = slotEntries[ei];
                var tex = _ensureLayerSlotTex(entry.shotId);
                if (!tex) continue;
                _uploadLayerSlotTex(entry.shotId);

                var drawW = defSize, drawH = defSize;
                var texEntry = pp._boneTexCache[entry.shotId];
                if (texEntry && texEntry.img && texEntry.img.width && texEntry.img.height) {
                    drawW = texEntry.img.width; drawH = texEntry.img.height;
                }
                var offX = entry.shotIdx * 5, offY = entry.shotIdx * 5;

                // ★ 直接使用预提取的骨骼矩阵分量构建模型矩阵
                var model = new Float32Array(16);
                model.fill(0);
                model[0] = entry.boneA * drawW;
                model[1] = entry.boneB * drawW;
                model[4] = entry.boneC * drawH;
                model[5] = entry.boneD * drawH;
                model[12] = entry.bx + offX;
                model[13] = entry.by + offY;
                model[10] = 1;
                model[15] = 1;

                var mvp = new Float32Array(16);
                SMTool._mulM4(mvp, ortho, model);
                gl.uniformMatrix4fv(qr.uMVP, false, mvp);
                gl.uniform1f(qr.uAlpha, 0.9);

                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        }
    }

    SMTool._restoreGL(gl, saved);
};
