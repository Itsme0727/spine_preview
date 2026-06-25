/* ================================================================
   应用主入口 — SMTool 公共 API & 初始化
   挂载到全局 SMTool 对象，汇总所有模块功能
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 公共方法 ----

// 添加空节点
SMTool.addSpineNode = function () {
    SMTool.pushUndo();
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
    node.x = wp.x;
    node.y = wp.y;
    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);
    SMData.selectedNodes.clear();
    SMData.selectedNodes.add(id);
    SMData.selectedNode = id;
    SMTool._updateSel();
    SMTool._updateSB();
};

// 删除节点
SMTool.deleteNode = function (nid) {
    console.log('[DeleteNode] nid=' + nid + ' nodesBefore=' + SMData.nodes.size);
    SMTool.pushUndo();
    // 删除相关连线
    SMData.connections = SMData.connections.filter(function (c) {
        return c.fromNode !== nid && c.toNode !== nid;
    });

    // 清理 WebGL 资源
    var node = SMData.nodes.get(nid);
    if (node) {
        if (node.state) node.state.clearTracks();
        // 通过缓存释放纹理（引用计数归零才真正 dispose）
        SMTool._releaseNodeTextures(node);
        if (node.batcher) { try { node.batcher.dispose(); } catch (e) {} node.batcher = null; }
        if (node.shader) { try { node.shader.dispose(); } catch (e) {} node.shader = null; }
        if (node.skeletonRenderer) { try { node.skeletonRenderer.dispose(); } catch (e) {} node.skeletonRenderer = null; }
        // SceneRenderer 可以 dispose（每个节点独立的 shader/program），
        // 但共享的 ManagedWebGLRenderingContext 不要 dispose
        if (node.sceneRenderer) { try { node.sceneRenderer.dispose(); } catch (e) {} node.sceneRenderer = null; }
        // 清除 _managedContext 引用但不 dispose（它是共享的）
        node._managedContext = null;

        // ★ 释放全局截图注册表中的引用
        if (node._boneScreenshots) {
            var shotBones = Object.keys(node._boneScreenshots);
            for (var sbi = 0; sbi < shotBones.length; sbi++) {
                var shotList = node._boneScreenshots[shotBones[sbi]];
                if (!Array.isArray(shotList)) shotList = [shotList];
                for (var sli = 0; sli < shotList.length; sli++) {
                    if (typeof shotList[sli] === 'number') {
                        SMData._shotRelease(shotList[sli]);
                    }
                }
            }
        }
    }

    // ★ 清理层级节点中对被删节点的引用
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        var ln = r2.value;
        if (ln.nodeType === 'layer' && ln._layerData && ln._layerData.layers) {
            var ld2 = ln._layerData;
            for (var lk2 = 1; lk2 <= ld2.layerCount; lk2++) {
                if (ld2.layers[lk2] && ld2.layers[lk2].animNodeId === nid) {
                    delete ld2.layers[lk2];
                }
            }
            SMTool._updateLayerEl(ln);
        }
        r2 = nodesIter2.next();
    }

    var el = SMTool._getEl(nid);
    if (el) el.remove();

    // 清除共享 WebGL 画布上该节点的残留画面
    if (node && node._canvasWidth && node._canvasHeight) {
        var sharedGL = SMTool._sharedGL;
        var sharedCanvas = SMTool._sharedCanvas;
        if (sharedGL && sharedCanvas) {
            try {
                var sp = SMTool.worldToCanvas(node.x, node.y);
                var sx = Math.round(sp.x);
                var sy = Math.round(sp.y);
                var z = SMData.view.zoom;
                var sw = Math.round(node._canvasWidth * z);
                var sh = Math.round(node._canvasHeight * z);
                var glY = sharedCanvas.height - sy - sh;

                sharedGL.enable(sharedGL.SCISSOR_TEST);
                sharedGL.scissor(sx, glY, sw, sh);
                sharedGL.clearColor(0, 0, 0, 0);
                sharedGL.clearStencil(0);
                sharedGL.clear(sharedGL.COLOR_BUFFER_BIT | sharedGL.STENCIL_BUFFER_BIT);
                sharedGL.disable(sharedGL.SCISSOR_TEST);
            } catch (e) { /* 忽略清除错误 */ }
        }
    }

    SMData.nodes.delete(nid);
    SMData.selectedNodes.delete(nid);
    if (SMData.selectedNode === nid) SMData.selectedNode = null;

    // 清理该节点的浮动标签（缩放 < 40% 时显示的大字标签）
    SMTool._updateFloatLabels();

    // ★ 若删除的是预览面板的源节点，关闭预览
    if (SMData._animPreview.visible && SMData._animPreview.nodeId === nid) {
        SMTool._hideAnimPreview();
    }

    // 🔒 [LOCK-L] 并行播放面板刷新及时性 — 节点删除后刷新层级显示
    // ★ 立即刷新所有层级节点盒子文字
    if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();
    // ★ 若被删节点属于某层级，刷新对应浮窗
    if (typeof SMTool._refreshLayerPreviewIfOpen === 'function') {
        var nodesIter3 = SMData.nodes.values();
        var r3 = nodesIter3.next();
        while (!r3.done) {
            if (r3.value.nodeType === 'layer') SMTool._refreshLayerPreviewIfOpen(r3.value);
            r3 = nodesIter3.next();
        }
    }
    SMTool._updateSel();
    SMTool._updateSB();
    SMTool._updateStateRowColors();
    SMTool._updateDuplicateHighlights();
    SMTool._checkMissingStates();
};

// 复制节点（通用，可指定偏移量）
SMTool.copyNode = function (nid, offsetX, offsetY) {
    var orig = SMData.nodes.get(nid);
    if (!orig) return null;

    offsetX = offsetX || 0;
    offsetY = offsetY || 0;

    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.name = orig.name;
    node.sourceFile = orig.sourceFile;
    node.x = orig.x + offsetX;
    node.y = orig.y + offsetY;
    node._srcSkelJson = orig._srcSkelJson;
    node._srcSkelBinBase64 = orig._srcSkelBinBase64;
    node._srcAtlasText = orig._srcAtlasText;
    node._srcTexDataUrl = orig._srcTexDataUrl;
    node._srcTexDataUrls = orig._srcTexDataUrls ? orig._srcTexDataUrls.slice() : [];
    node._srcType = orig._srcType;
    node._srcFileNames = orig._srcFileNames ? orig._srcFileNames.slice() : [];
    node.currentAnim = orig.currentAnim;
    node.currentSkin = orig.currentSkin;
    node.animations = orig.animations.slice();
    node.skins = orig.skins.slice();
    node.slots = orig.slots.slice();
    node.bones = orig.bones.slice();
    node.version = orig.version;
    node._customScale = orig._customScale;
    node._playbackSpeed = (typeof orig._playbackSpeed === 'number') ? orig._playbackSpeed : 1.0;
    node._debugOffsetX = orig._debugOffsetX || 0;
    node._debugOffsetY = orig._debugOffsetY || 0;
    node._debugCanvasW = orig._debugCanvasW || 0;
    node._debugCanvasH = orig._debugCanvasH || 0;
    node._boneTags = orig._boneTags ? JSON.parse(JSON.stringify(orig._boneTags)) : {};
    node._boneNotes = orig._boneNotes ? JSON.parse(JSON.stringify(orig._boneNotes)) : {};
    // ★ 性能优化：共享截图引用而非深拷贝 dataUrl。
    // 同一来源的节点复制时，_boneScreenshots 只存 shotId（数字），
    // 实际图片数据在全局 SMData._shotStore 中只有一份。
    node._boneScreenshots = {};
    if (orig._boneScreenshots) {
        var origBones = Object.keys(orig._boneScreenshots);
        for (var obi = 0; obi < origBones.length; obi++) {
            var bName = origBones[obi];
            var origShots = orig._boneScreenshots[bName];
            if (!Array.isArray(origShots)) origShots = origShots ? [origShots] : [];
            node._boneScreenshots[bName] = [];
            for (var osi = 0; osi < origShots.length; osi++) {
                var sVal = origShots[osi];
                if (typeof sVal === 'number') {
                    // 新格式：shotId 引用计数+1
                    SMData._shotAddRef(sVal);
                    node._boneScreenshots[bName].push(sVal);
                } else if (typeof sVal === 'string') {
                    // 旧格式兼容：注册到全局表后存 shotId
                    var newShotId = SMData._shotRegister(sVal);
                    node._boneScreenshots[bName].push(newShotId);
                }
            }
        }
    }
    node._boneFade = orig._boneFade ? JSON.parse(JSON.stringify(orig._boneFade)) : {};
    node._boneShotRefs = orig._boneShotRefs ? JSON.parse(JSON.stringify(orig._boneShotRefs)) : {};

    // ★ 皮肤备注/截图/淡入淡出
    node._skinTags = orig._skinTags ? JSON.parse(JSON.stringify(orig._skinTags)) : {};
    node._skinNotes = orig._skinNotes ? JSON.parse(JSON.stringify(orig._skinNotes)) : {};
    node._skinFade = orig._skinFade ? JSON.parse(JSON.stringify(orig._skinFade)) : {};
    node._skinScreenshots = {};
    if (orig._skinScreenshots) {
        var origSkins = Object.keys(orig._skinScreenshots);
        for (var oski = 0; oski < origSkins.length; oski++) {
            var skName2 = origSkins[oski];
            var origSkinShots = orig._skinScreenshots[skName2];
            if (!Array.isArray(origSkinShots)) origSkinShots = origSkinShots ? [origSkinShots] : [];
            node._skinScreenshots[skName2] = [];
            for (var ossi = 0; ossi < origSkinShots.length; ossi++) {
                var sv = origSkinShots[ossi];
                if (typeof sv === 'number') {
                    SMData._shotAddRef(sv);
                    node._skinScreenshots[skName2].push(sv);
                } else if (typeof sv === 'string') {
                    var newSid = SMData._shotRegister(sv);
                    node._skinScreenshots[skName2].push(newSid);
                }
            }
        }
    }

    // ★ 插槽标记/备注/截图/淡入淡出
    node._slotTags = orig._slotTags ? JSON.parse(JSON.stringify(orig._slotTags)) : {};
    node._slotNotes = orig._slotNotes ? JSON.parse(JSON.stringify(orig._slotNotes)) : {};
    node._slotFade = orig._slotFade ? JSON.parse(JSON.stringify(orig._slotFade)) : {};
    node._slotScreenshots = {};
    if (orig._slotScreenshots) {
        var origSlots = Object.keys(orig._slotScreenshots);
        for (var osli = 0; osli < origSlots.length; osli++) {
            var slName2 = origSlots[osli];
            var origSlotShots = orig._slotScreenshots[slName2];
            if (!Array.isArray(origSlotShots)) origSlotShots = origSlotShots ? [origSlotShots] : [];
            node._slotScreenshots[slName2] = [];
            for (var ossj = 0; ossj < origSlotShots.length; ossj++) {
                var sv2 = origSlotShots[ossj];
                if (typeof sv2 === 'number') {
                    SMData._shotAddRef(sv2);
                    node._slotScreenshots[slName2].push(sv2);
                } else if (typeof sv2 === 'string') {
                    var newSid2 = SMData._shotRegister(sv2);
                    node._slotScreenshots[slName2].push(newSid2);
                }
            }
        }
    }
    node._boneShotRefs = orig._boneShotRefs ? JSON.parse(JSON.stringify(orig._boneShotRefs)) : {};
    node._stateDesc = orig._stateDesc || '';
    node._textContent = orig._textContent || '';
    node._lineBreakPositions = orig._lineBreakPositions ? orig._lineBreakPositions.slice() : [];  // ★ 复制标题节点换行位置
    node._loopMode = orig._loopMode || null;
    node._loopCount = (orig._loopCount !== undefined) ? orig._loopCount : 1;
    node._loopTime = (orig._loopTime !== undefined) ? orig._loopTime : null;
    node._exitText = orig._exitText || '';
    node.loop = orig.loop;
    // 深拷贝轨道配置 + 过渡表 + 轨道序列
    node.tracks = orig.tracks ? JSON.parse(JSON.stringify(orig.tracks)) : [];
    node._mixTable = orig._mixTable ? JSON.parse(JSON.stringify(orig._mixTable)) : {};
    node._trackMode = orig._trackMode || false;
    node._trackName = orig._trackName || '轨道动画';
    node._trackSequence = orig._trackSequence ? JSON.parse(JSON.stringify(orig._trackSequence)) : [];

    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);

    if (node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
        (node._srcSkelJson || node._srcSkelBinBase64)) {
        SMTool._loadFromSourceData(node).then(function () {
            SMTool._updateEl(node);
            // ★ 轨道模式：序列数据已复制，加载完成后应用序列
            if (node._trackMode && node.state) {
                SMTool._applyTrackSequence(node);
            }
            SMTool._updateDuplicateHighlights();
            SMTool._checkMissingStates();
            SMTool._refreshAllTranslations();
            setTimeout(function () { SMTool._updateStateRowColors(); }, 150);
        }).catch(function (err) {
            console.error('[Copy] Failed to restore rendering:', err);
        });
    }

    return node;
};

// 复制节点（右键菜单）
SMTool.ctxDuplicateNode = function () {
    if (!SMData.selectedNode) return;
    SMTool.pushUndo();
    var newNode = SMTool.copyNode(SMData.selectedNode, 50, 50);
    if (!newNode) return;

    SMData.selectedNodes.clear();
    SMData.selectedNodes.add(newNode.id);
    SMData.selectedNode = newNode.id;
    SMTool._updateSel();
    SMTool._updateSB();
    SMTool._updateDuplicateHighlights();
    SMTool._checkMissingStates();
    document.getElementById('ctxMenu').style.display = 'none';
};

// 切换皮肤（同步同归属文件的所有节点）
// ================================================================
// 🔒🔒🔒 [LOCK-H] 皮肤切换仅应用于选中的动画节点
// ⚠️ 不可轻易修改重要逻辑代码，很容易引起浮窗动画的播放抽帧卡顿的bug，
//    如需修改，一定要寻求同意"解锁"才可以。
//
// 旧逻辑：同源文件所有节点一起切换 → 新逻辑：仅选中节点切换。
// 遍历 selectedNodes 集合，逐个应用皮肤并刷新 UI。
// 浮窗预览若显示任一选中节点，同步更新皮肤。
// ================================================================
SMTool._setSkin = function (nid, skinName) {
    var clickedNode = SMData.nodes.get(nid);
    if (!clickedNode || !clickedNode.skeleton || !clickedNode.skeletonData) return;

    // 收集需要切换皮肤的节点：选中节点中属于同一源文件的 Spine 节点
    var targetNodes = [];
    var selIter = SMData.selectedNodes.values();
    var sr = selIter.next();
    while (!sr.done) {
        var node = SMData.nodes.get(sr.value);
        if (node && node.skeleton && node.skeletonData && node.sourceFile === clickedNode.sourceFile) {
            targetNodes.push(node);
        }
        sr = selIter.next();
    }

    // 如果选中节点中没有可切换的，至少保证点击的节点被处理
    if (targetNodes.length === 0) {
        targetNodes.push(clickedNode);
    }

    // 逐个应用皮肤
    for (var ni = 0; ni < targetNodes.length; ni++) {
        var node = targetNodes[ni];
        var skin = null;
        var sd = node.skeletonData;
        for (var i = 0; i < sd.skins.length; i++) {
            if (sd.skins[i].name === skinName) {
                skin = sd.skins[i];
                break;
            }
        }
        if (skin) {
            node.skeleton.setSkin(skin);
            node.skeleton.setSlotsToSetupPose();
            node.currentSkin = skinName;
        }

        // 刷新该节点 UI 高亮
        var el = SMTool._getEl(node.id);
        if (el) {
            var badges = el.querySelectorAll('.skin-badge');
            for (var b = 0; b < badges.length; b++) {
                if (badges[b].textContent === skinName) {
                    badges[b].classList.add('active');
                } else {
                    badges[b].classList.remove('active');
                }
            }
        }
    }

    // 同步刷新数据面板高亮
    SMData._lastPanelNodeId = -1;
    SMTool._updateFloatPanel();

    // ★ 切换皮肤后立即刷新浮窗预览（如果当前预览节点在被切换的节点中）
    var pp = SMData._animPreview;
    if (pp && pp.visible && pp.skeleton && pp.nodeId != null) {
        for (var nj = 0; nj < targetNodes.length; nj++) {
            if (targetNodes[nj].id === pp.nodeId) {
                SMTool._syncPreviewPmaAndSkin(pp, targetNodes[nj]);
                break;
            }
        }
    }
};
// 🔒 [LOCK-H] END
SMTool.toggleConnectMode = function () {
    SMData.connectMode = !SMData.connectMode;
    document.getElementById('btnConnect').classList.toggle('active', SMData.connectMode);
    SMData.connecting = null;
    SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
    SMTool._updateSel();
};

// 保存条件
SMTool.saveCondition = function () {
    SMTool.pushUndo();
    var ed = document.getElementById('conditionEditor');
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === ed._cid) {
            SMData.connections[i].condition = document.getElementById('condInput').value.trim();
            break;
        }
    }
    ed.classList.remove('show');
    SMTool._updateFlowPanel();
};

// 删除连线
SMTool.deleteConnection = function () {
    SMTool.pushUndo();
    var ed = document.getElementById('conditionEditor');
    SMData.connections = SMData.connections.filter(function (x) {
        return x.id !== ed._cid;
    });
    SMData.selectedConnection = null;
    ed.classList.remove('show');
    SMTool._updateSB();
    SMTool._updateStateRowColors();
};

// 切换网格
SMTool.toggleGrid = function () {
    SMData.showGrid = !SMData.showGrid;
    document.getElementById('btnGrid').classList.toggle('active', SMData.showGrid);
};

// 右键菜单 - 删除节点（支持多选）
SMTool.ctxDeleteNode = function () {
    if (SMData.selectedNodes.size > 1) {
        var toDelete = [];
        SMData.selectedNodes.forEach(function (id) { toDelete.push(id); });
        for (var i = 0; i < toDelete.length; i++) {
            SMTool.deleteNode(toDelete[i]);
        }
        SMData.selectedNodes.clear();
        SMData.selectedNode = null;
    } else if (SMData.selectedNode) {
        SMTool.deleteNode(SMData.selectedNode);
    }
    document.getElementById('ctxMenu').style.display = 'none';
};

// ---- 初始化 ----
SMTool.init = function () {
    // 画布引用
    SMTool.gridCanvas = document.getElementById('gridCanvas');
    SMTool.gridCtx = SMTool.gridCanvas.getContext('2d');
    SMTool.connCanvas = document.getElementById('connCanvas');
    SMTool.connCtx = SMTool.connCanvas.getContext('2d');
    SMTool.nodesLayer = document.getElementById('nodesLayer');

    // 初始化共享 WebGL 渲染器（只创建一次，所有 Spine 节点共用）
    SMTool._initSharedRenderer();

    // 初始化鸟瞰图（左下角小地图）
    SMTool._initMinimap();

    SMTool.resize();
    // ★ 优化：防抖 resize 事件，避免拖拽窗口边缘时频繁触发导致卡顿
    var _resizeTimer = 0;
    window.addEventListener('resize', function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(function () { SMTool.resize(); }, 80);
    });

    // 鼠标事件（数据面板内的操作不取消动画对象选中）
    document.addEventListener('mousedown', function (e) {
        // ★ 层级位置修改模式激活时：预览面板内的点击穿透到画布，用于移动骨架位置
        if (e.button === 0 && SMData._animPreview && SMData._animPreview._layerPosMode && SMData._animPreview._layerPosMode.active) {
            if (e.target && (e.target.id === 'appCanvas' || (e.target.closest && e.target.closest('#appCanvas')))) {
                SMTool._onLayerPosMouseDown(e);
            }
            return;
        }
        if (e.target.closest && e.target.closest('#toolbar, #ctxMenu, #conditionEditor, #zoomControl, #statusBar, #dataFloatPanel, #flowPanel, #flowModeToggle, #animPreviewPanel, #searchPanel')) return;
        if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
        if (e.shiftKey) e.preventDefault();
        SMTool._onMD(e);
    });
    window.addEventListener('mousemove', function (e) { SMTool._onMM(e); });
    window.addEventListener('mouseup', function (e) { SMTool._onMU(e); });

    // 滚轮缩放（面板内滚动内容，不缩放画布）
    window.addEventListener('wheel', function (e) {
        // ★ 调试模式：滚轮始终用于缩放动画层
        if (SMData._debugMode) { e.preventDefault(); SMTool._onWheel(e); return; }
        if (!e.target.closest('.state-list') && !e.target.closest('.anim-bar') && !e.target.closest('.anim-select') && !e.target.closest('.ip-body') && !e.target.closest('#conditionEditor') && !e.target.closest('#dataFloatPanel') && !e.target.closest('#animPreviewPanel') && !e.target.closest('#screenshotOverlay') && !e.target.closest('#searchPanel')) {
            e.preventDefault();
            SMTool._onWheel(e);
        }
    }, { passive: false });

    // 全局阻止浏览器右键菜单
    document.addEventListener('contextmenu', function (e) {
        if (e.target.closest('input, textarea, select')) return;  // 表单元素允许右键
        e.preventDefault();
        SMTool._showCtxMenu(e);
    });

    // 缩放滑块
    document.getElementById('zoomSlider').addEventListener('input', function (e) {
        SMTool._onZoomSlider(e);
    });

    // 拖拽区域
    var dz = document.getElementById('dropZone');
    document.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('show'); });
    dz.addEventListener('dragover', function (e) { e.preventDefault(); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('show'); });
    dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('show'); SMTool._onDrop(e); });
    // ★ 兜底：拖拽到 dropZone 之外时也能响应（快速拖放等场景）
    document.addEventListener('drop', function (e) {
        if (e.target === dz || dz.contains(e.target)) return; // dropZone 已处理
        // 检查是否拖到了 Spine 节点面板内部（节点内部有自己的拖放处理）
        if (e.target.closest('.spine-canvas-wrap') || e.target.closest('.dfp-shot-add') ||
            e.target.closest('.spine-node') || e.target.closest('input, textarea, select')) return;
        e.preventDefault();
        dz.classList.remove('show');
        SMTool._onDrop(e);
    });

    // 键盘
    window.addEventListener('keydown', function (e) { SMTool._onKD(e); });
    // ★ 空格键释放 → 停止平移
    window.addEventListener('keyup', function (e) {
        if (e.key === ' ' && SMData._spacePanning) {
            SMData._spacePanning = false;
            SMData.isPanning = false;
            document.body.style.cursor = '';
            SMTool.gridCanvas.style.cursor = SMData.connectMode ? 'crosshair' : 'default';
        }
    });

    // 全局粘贴事件（图片 → 自动添加到当前聚焦骨骼的截图区）
    window.addEventListener('paste', function (e) {
        var items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        // 检查是否有图片
        var imageBlobs = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].type && items[i].type.indexOf('image/') === 0) {
                try { var f = items[i].getAsFile(); if (f) imageBlobs.push(f); } catch (ex) {}
            }
        }
        if (imageBlobs.length === 0) return; // 纯文本 → 浏览器正常处理

        e.preventDefault();
        var node = SMData.selectedNode ? SMData.nodes.get(SMData.selectedNode) : null;

        // ================================================================
        // ★ 确定粘贴目标（name + type）
        // ================================================================
        var targetName = SMData._pasteTargetBone;
        var targetType = SMData._pasteTargetType || 'bone';

        // 方式 B：光标在数据面板展开的文本框内 → 自动识别所在行
        if (!targetName) {
            var focusedEl = document.activeElement;
            if (focusedEl && focusedEl.closest && focusedEl.closest('#dataFloatPanel') && SMData._floatPanel && SMData._floatPanel.expanded) {
                var noteArea = focusedEl.closest('[data-bone-note]');
                if (noteArea && node && node.nodeType === 'spine') {
                    targetName = noteArea.getAttribute('data-bone-note');
                    if (targetName) {
                        targetType = 'bone';
                        if (node.skins && node.skins.indexOf(targetName) >= 0) targetType = 'skin';
                        else if (node.slots && node.slots.indexOf(targetName) >= 0) targetType = 'slot';
                        else if (node._eventScreenshots && Object.prototype.hasOwnProperty.call(node._eventScreenshots, targetName)) targetType = 'event';
                    }
                }
            }
        }

        // ================================================================
        // ★ 执行粘贴
        // ================================================================

        // 路径 1：粘贴到数据面板子项（骨骼/皮肤/插槽/关键帧）
        if (targetName && node && node.nodeType === 'spine') {
            var loadedA = 0; var dataUrlsA = [];
            for (var ja = 0; ja < imageBlobs.length; ja++) {
                (function (blob) {
                    var rdr = new FileReader();
                    rdr.onload = function () {
                        dataUrlsA.push(rdr.result); loadedA++;
                        if (loadedA === imageBlobs.length) {
                            SMTool._addScreenshots(targetName, dataUrlsA, targetType);
                            document.getElementById('sbStatus').textContent = '✅ 已粘贴 ' + loadedA + ' 张截图 → ' + targetName;
                            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
                        }
                    };
                    rdr.onerror = function () { loadedA++; };
                    rdr.readAsDataURL(blob);
                })(imageBlobs[ja]);
            }
            return;
        }

        // 路径 2：粘贴到节点面板右上角图片附件（spine 或 entry 节点被选中）
        if (node && (node.nodeType === 'spine' || node.nodeType === 'entry')) {
            for (var k = 0; k < imageBlobs.length; k++) {
                (function (blob) {
                    var rdr2 = new FileReader();
                    rdr2.onload = function () {
                        var sid = SMData._shotRegister(rdr2.result);
                        node._nodeImages.push(sid);
                        if (!node._nodeShotRefs) node._nodeShotRefs = [];
                        var ent = SMData._shotStore[sid];
                        var ext = 'png';
                        if (ent && ent.dataUrl) {
                            var m = ent.dataUrl.match(/^data:(image\/\w+);/);
                            if (m) ext = m[1].split('/')[1];
                            if (ext === 'jpeg') ext = 'jpg';
                        }
                        node._nodeShotRefs.push('_assets/img_' + sid + '.' + ext);
                        SMTool._refreshNodeImages(node.id);
                    };
                    rdr2.readAsDataURL(blob);
                })(imageBlobs[k]);
            }
            document.getElementById('sbStatus').textContent = '✅ 已粘贴 ' + imageBlobs.length + ' 张图片到节点面板';
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
            return;
        }

        // 路径 3：无目标 → 提示
        document.getElementById('sbStatus').textContent = '⚠️ 请先点击数据面板"📋 粘贴截图"或选中动画节点，再 Ctrl+V';
        setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 3000);
    });

    // 全局点击关闭右键菜单
    window.addEventListener('click', function () {
        document.getElementById('ctxMenu').style.display = 'none';
    });

    // 双击重置控制点 / 编辑组标题 / 进入组编辑模式
    window.addEventListener('dblclick', function (e) {
        // ★ 优先检测：双击组标题 → 编辑组名
        if (SMData._groupTitleRects) {
            for (var gi = 0; gi < SMData._groupTitleRects.length; gi++) {
                var gr = SMData._groupTitleRects[gi];
                if (e.clientX >= gr.x && e.clientX <= gr.x + gr.w &&
                    e.clientY >= gr.y && e.clientY <= gr.y + gr.h) {
                    // 找到对应组对象
                    for (var gj = 0; gj < SMData.groups.length; gj++) {
                        if (SMData.groups[gj].id === gr.groupId) {
                            SMTool._showGroupTitleEditor(gr.groupId, gr.x, gr.y, gr.w, gr.h, SMData.groups[gj].title || '');
                            return;
                        }
                    }
                }
            }
        }

        var cp = SMTool._findCP(e.clientX, e.clientY, 18);
        if (cp) {
            for (var i = 0; i < SMData.connections.length; i++) {
                var conn = SMData.connections[i];
                if (conn.id === cp.connId) {
                    var fn = SMData.nodes.get(conn.fromNode);
                    var tn = SMData.nodes.get(conn.toNode);
                    if (fn && tn) {
                        var fp = SMTool._getStateConnectorPos(fn, conn.fromState, 'output');
                        var tp = SMTool._getStateConnectorPos(tn, conn.toState, 'input');
                        if (fp && tp) {
                            var def = SMTool._defaultCPOffsets(fp, tp);
                            conn.cp1x = def.cp1x;
                            conn.cp1y = def.cp1y;
                            conn.cp2x = def.cp2x;
                            conn.cp2y = def.cp2y;
                            SMData.hoveredCP = null;
                        }
                    }
                    break;
                }
            }
        }

        // ★ 双击组内节点 → 进入/退出组编辑模式
        var wpDbl = SMTool.canvasToWorld(e.clientX, e.clientY);
        var nodesIterDbl = SMData.nodes.values();
        var rDbl = nodesIterDbl.next();
        var foundDbl = null;
        while (!rDbl.done) {
            if (SMTool._hitTest(rDbl.value, wpDbl.x, wpDbl.y)) { foundDbl = rDbl.value; break; }
            rDbl = nodesIterDbl.next();
        }
        if (foundDbl) {
            var grpDbl = SMTool._findGroupOf(foundDbl.id);
            if (grpDbl) {
                if (SMData._groupEditMode === grpDbl.id) {
                    // 再次双击同一组 → 退出编辑模式
                    SMData._groupEditMode = null;
                    SMTool._updateSel();
                } else {
                    // 进入组编辑模式
                    SMData._groupEditMode = grpDbl.id;
                    SMData.selectedNodes.clear();
                    SMData.selectedNodes.add(foundDbl.id);
                    SMData.selectedNode = foundDbl.id;
                    SMTool._updateSel();
                }
            }
        } else {
            // 双击空白 → 退出组编辑模式
            SMData._groupEditMode = null;
            SMTool._updateSel();
        }
    });

    // 条件编辑器键盘事件 + textarea 自适应高度 + 失焦自动保存
    var ce = document.getElementById('conditionEditor');
    var condInput = document.getElementById('condInput');
    ce.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); SMTool.saveCondition(); }
        if (e.key === 'Escape') ce.classList.remove('show');
    });
    // textarea 自动调整高度
    condInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    // 失焦自动保存
    condInput.addEventListener('blur', function () {
        // 延迟检查，避免点击"删除连线"/"确定"按钮时重复触发
        setTimeout(function () {
            if (ce.classList.contains('show')) {
                SMTool.saveCondition();
            }
        }, 150);
    });

    // ---- 动画组模式切换 ----
    SMTool.setFlowMode = function (mode) {
        SMData.flowMode = mode;
        var fm3 = document.getElementById('flowModeThree');
        var fmf = document.getElementById('flowModeFull');
        if (fm3) fm3.classList.toggle('active', mode === 'three');
        if (fmf) fmf.classList.toggle('active', mode === 'full');
        // 清除焦点和播放状态
        SMData._flowFocus = null;
        SMData._fullPlayback.activePathIdx = -1;
        SMData._fullPlayback.currentStep = 0;
        SMData._fullPlayback.isPlaying = false;
        if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
        SMTool._clearAllProgressBars();
        SMTool._resumeAllNodes();
        SMTool._updateFlowPanel();
        if (mode === 'full' && SMData.selectedNode) {
            SMTool._setFullComponentFocus(SMData.selectedNode);
        }
        SMTool._updateSel();
        SMTool._updateStateRowColors();
    };

    // ---- 完整动画组路径穷举（DFS 从源节点到所有终点） ----
    // ★★★ v2: layer 节点不拆分路径，作为 hub 内嵌分支信息 ★★★
    SMTool._findAllFullPaths = function (sourceId) {
        var paths = [];

        // ★ 辅助：沿唯一下游链追踪分支（遇死胡同/环/layer 节点停止）
        function traceBranchChain(startId, excludeIds) {
            var nodes = [];
            var conns = [];
            var currentId = startId;
            var chainVisited = new Set();
            chainVisited.add(startId);
            var maxSteps = 50; // 安全上限
            while (maxSteps-- > 0) {
                var outConns = [];
                for (var i = 0; i < SMData.connections.length; i++) {
                    var c = SMData.connections[i];
                    if (c.fromNode === currentId) outConns.push(c);
                }
                if (outConns.length === 0) break;
                // 选择第一条非 layer 出边（优先普通连线，跳过 layer 层连线）
                var chosen = null;
                for (var j = 0; j < outConns.length; j++) {
                    var nc = outConns[j];
                    var fn = SMData.nodes.get(nc.fromNode);
                    if (fn && fn.nodeType === 'layer') continue; // 跳过层连线本身
                    if (excludeIds && excludeIds.has(nc.toNode)) continue;
                    if (chainVisited.has(nc.toNode)) continue;
                    chosen = nc;
                    break;
                }
                if (!chosen) break;
                var nextNode = SMData.nodes.get(chosen.toNode);
                if (!nextNode) break;
                var animName = chosen.toState || nextNode.currentAnim ||
                    (nextNode.animations && nextNode.animations.length > 0 ? nextNode.animations[0].name : nextNode.name);
                nodes.push({ id: chosen.toNode, anim: animName });
                conns.push(chosen.id);
                chainVisited.add(chosen.toNode);
                currentId = chosen.toNode;
                // 遇到 layer 节点则停止
                if (nextNode.nodeType === 'layer') break;
            }
            return { nodes: nodes, conns: conns, endId: currentId };
        }

        // ★ 辅助：收集从起点可达的全部节点 ID
        function collectReachable(startId, excludeIds, maxNodes) {
            maxNodes = maxNodes || 100;
            var reachable = new Set();
            var queue = [startId];
            var visited2 = new Set();
            visited2.add(startId);
            while (queue.length > 0 && maxNodes-- > 0) {
                var cur = queue.shift();
                reachable.add(cur);
                for (var i = 0; i < SMData.connections.length; i++) {
                    var c = SMData.connections[i];
                    if (c.fromNode === cur && !visited2.has(c.toNode)) {
                        if (excludeIds && excludeIds.has(c.toNode)) continue;
                        visited2.add(c.toNode);
                        queue.push(c.toNode);
                    }
                }
            }
            return reachable;
        }

        function dfs(currentId, nodePath, connPath, pathVisited) {
            var currentNode = SMData.nodes.get(currentId);

            // ════════════════════════════════════════════════════════
            // ★★★ LAYER HUB 处理：不拆分路径 ★★★
            // ════════════════════════════════════════════════════════
            if (currentNode && currentNode.nodeType === 'layer') {
                // 收集所有出边（layer connections）
                var layerConns = [];
                for (var li = 0; li < SMData.connections.length; li++) {
                    var lc = SMData.connections[li];
                    if (lc.fromNode === currentId) layerConns.push(lc);
                }
                // 按 _layerNum 排序（兜底：解析 fromState 'layer_N'）
                layerConns.sort(function (a, b) {
                    var la = a._layerNum || parseInt((a.fromState || '').replace('layer_', '')) || 999;
                    var lb = b._layerNum || parseInt((b.fromState || '').replace('layer_', '')) || 999;
                    return la - lb;
                });

                if (layerConns.length === 0) {
                    // 无出边的 layer 节点 → 死胡同，记录路径
                    if (nodePath.length >= 1) {
                        paths.push({ nodes: nodePath.slice(), conns: connPath.slice() });
                    }
                    return;
                }

                // 排除集合：已在路径中的节点 + layer 节点自身
                var stopIds = new Set(pathVisited);
                stopIds.add(currentId);

                // 追踪每条分支
                var branches = [];
                var branchReachableSets = [];
                for (var bi = 0; bi < layerConns.length; bi++) {
                    var lconn = layerConns[bi];
                    var layerNum = lconn._layerNum || parseInt((lconn.fromState || '').replace('layer_', '')) || (bi + 1);
                    var directTargetId = lconn.toNode;

                    // ★ 沿下游解析第一个 Spine 动画节点（跳过延时器等非动画节点）
                    var resolved = SMTool._resolveAnimNodeDownstream(directTargetId);
                    var branchStartId = resolved.resolvedId;
                    // 记录解析信息供渲染使用
                    var resolvedAnimNodeId = (resolved.resolvedId !== directTargetId) ? resolved.resolvedId : null;

                    if (pathVisited.has(branchStartId)) {
                        // 分支起点已访问 → 环
                        branches.push({ layer: layerNum, nodes: [], conns: [lconn.id], endId: branchStartId, _cycleClose: true, _resolvedAnimNodeId: resolvedAnimNodeId });
                        branchReachableSets.push(new Set());
                        continue;
                    }

                    var traceResult = traceBranchChain(branchStartId, stopIds);
                    var reachable = collectReachable(branchStartId, stopIds);
                    branchReachableSets.push(reachable);

                    // 构建分支节点列表（含层连线本身）
                    var branchNodes = [];
                    var branchConns = [lconn.id];
                    // ★ 分支起始节点（解析后的动画节点）总是第一个
                    var startNode = resolved.animNode;
                    if (startNode) {
                        var startAnim = (branchStartId === directTargetId ? lconn.toState : '') ||
                            startNode.currentAnim ||
                            (startNode.animations && startNode.animations.length > 0 ? startNode.animations[0].name : startNode.name);
                        branchNodes.push({ id: branchStartId, anim: startAnim });
                    }
                    for (var tn = 0; tn < traceResult.nodes.length; tn++) {
                        branchNodes.push(traceResult.nodes[tn]);
                        if (tn < traceResult.conns.length) branchConns.push(traceResult.conns[tn]);
                    }

                    branches.push({
                        layer: layerNum,
                        nodes: branchNodes,
                        conns: branchConns,
                        endId: traceResult.endId,
                        _resolvedAnimNodeId: resolvedAnimNodeId
                    });
                }

                // ★ 求收敛点：所有分支可达节点集的交集
                var convergeId = null;
                if (branchReachableSets.length > 1) {
                    var intersection = null;
                    for (var si = 0; si < branchReachableSets.length; si++) {
                        if (branchReachableSets[si].size === 0) { intersection = new Set(); break; }
                        if (intersection === null) {
                            intersection = new Set(branchReachableSets[si]);
                        } else {
                            var newInter = new Set();
                            intersection.forEach(function (x) {
                                if (branchReachableSets[si].has(x)) newInter.add(x);
                            });
                            intersection = newInter;
                        }
                    }
                    if (intersection && intersection.size > 0) {
                        var interArr = [];
                        intersection.forEach(function (x) { interArr.push(x); });
                        // 排除 layer 节点自身
                        for (var ii = 0; ii < interArr.length; ii++) {
                            if (interArr[ii] !== currentId) { convergeId = interArr[ii]; break; }
                        }
                    }
                }

                // 构建 layer hub 节点
                var layerAnim = currentNode.name || '📚 并行播放';
                var hubNode = {
                    id: currentId,
                    anim: layerAnim,
                    _isLayerHub: true,
                    _branches: branches,
                    _convergeId: convergeId
                };

                // 替换 nodePath 中最后一个简单节点为 hub 版本
                var hubIdx = nodePath.length - 1;
                var savedSimple = nodePath[hubIdx];
                nodePath[hubIdx] = hubNode;

                if (convergeId && !pathVisited.has(convergeId)) {
                    var convergeNode = SMData.nodes.get(convergeId);
                    if (convergeNode) {
                        var convergeAnim = convergeNode.currentAnim ||
                            (convergeNode.animations && convergeNode.animations.length > 0 ? convergeNode.animations[0].name : convergeNode.name);
                        // 收集从各分支末尾到收敛点的连线
                        var convergeConns = [];
                        var addedConnIds = new Set();
                        for (var ci = 0; ci < SMData.connections.length; ci++) {
                            var cc = SMData.connections[ci];
                            if (cc.toNode !== convergeId) continue;
                            if (addedConnIds.has(cc.id)) continue;
                            for (var bi2 = 0; bi2 < branches.length; bi2++) {
                                var br = branches[bi2];
                                var lastNodeId = br.nodes.length > 0 ? br.nodes[br.nodes.length - 1].id : br.endId;
                                if (cc.fromNode === lastNodeId || cc.fromNode === br.endId) {
                                    convergeConns.push(cc.id);
                                    addedConnIds.add(cc.id);
                                    break;
                                }
                            }
                        }
                        // 将收敛连线加入 connPath
                        var savedConnLen = connPath.length;
                        for (var cci = 0; cci < convergeConns.length; cci++) {
                            connPath.push(convergeConns[cci]);
                        }

                        nodePath.push({ id: convergeId, anim: convergeAnim });
                        pathVisited.add(convergeId);
                        dfs(convergeId, nodePath, connPath, pathVisited);
                        pathVisited.delete(convergeId);
                        nodePath.pop();
                        // 恢复 connPath
                        connPath.length = savedConnLen;
                    } else {
                        // 收敛节点不存在，记录路径
                        paths.push({ nodes: nodePath.slice(), conns: connPath.slice() });
                    }
                } else {
                    // 无收敛点 → layer 即为终点
                    paths.push({ nodes: nodePath.slice(), conns: connPath.slice() });
                }

                // 恢复简单节点（供回溯使用）
                nodePath[hubIdx] = savedSimple;
                return;
            }

            // ════════════════════════════════════════════════════════
            // 常规节点：原有 DFS 逻辑
            // ════════════════════════════════════════════════════════
            var outConns = [];
            for (var i2 = 0; i2 < SMData.connections.length; i2++) {
                var c2 = SMData.connections[i2];
                if (c2.fromNode === currentId) outConns.push(c2);
            }

            if (outConns.length === 0) {
                if (nodePath.length >= 1) {
                    paths.push({ nodes: nodePath.slice(), conns: connPath.slice() });
                }
                return;
            }

            for (var j = 0; j < outConns.length; j++) {
                var oc = outConns[j];
                var nextId = oc.toNode;
                if (pathVisited.has(nextId)) {
                    if (nodePath.length >= 1) {
                        var cycleConnPath = connPath.slice();
                        cycleConnPath.push(oc.id);
                        var cycleNodes = nodePath.slice();
                        var closeNode = SMData.nodes.get(nextId);
                        if (closeNode) {
                            var closeAnim = oc.toState || closeNode.currentAnim ||
                                (closeNode.animations && closeNode.animations.length > 0 ? closeNode.animations[0].name : closeNode.name);
                            cycleNodes.push({ id: nextId, anim: closeAnim, cycleClose: true });
                        }
                        paths.push({ nodes: cycleNodes, conns: cycleConnPath });
                    }
                    continue;
                }
                var nextNode = SMData.nodes.get(nextId);
                if (!nextNode) continue;
                var animName = oc.toState || nextNode.currentAnim ||
                    (nextNode.animations && nextNode.animations.length > 0 ? nextNode.animations[0].name : nextNode.name);

                nodePath.push({ id: nextId, anim: animName });
                connPath.push(oc.id);
                pathVisited.add(nextId);
                dfs(nextId, nodePath, connPath, pathVisited);
                pathVisited.delete(nextId);
                nodePath.pop();
                connPath.pop();
            }
        }

        var srcNode = SMData.nodes.get(sourceId);
        if (!srcNode) return paths;
        var srcAnim = srcNode.currentAnim ||
            (srcNode.animations && srcNode.animations.length > 0 ? srcNode.animations[0].name : srcNode.name);

        var visited = new Set();
        visited.add(sourceId);
        dfs(sourceId, [{ id: sourceId, anim: srcAnim }], [], visited);

        return paths;
    };

    // ---- 节点分组 ----
    SMTool._groupColors = ['#4a9eff','#4ec96e','#c98a3e','#c0705a','#4a9eff','#3a9db5','#d94a4a','#7ea83c'];

    SMTool.groupSelection = function () {
        if (SMData.selectedNodes.size < 2) return;
        SMTool.pushUndo();
        var ids = [];
        SMData.selectedNodes.forEach(function (id) { ids.push(id); });
        var gid = SMData.nextGroupId++;
        var g = {
            id: gid,
            nodeIds: new Set(ids),
            color: SMTool._groupColors[(gid - 1) % SMTool._groupColors.length],
            title: '组 ' + gid
        };
        SMData.groups.push(g);
        document.getElementById('sbStatus').textContent = '已打组 (' + ids.length + ' 节点)';
        setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
    };

    SMTool.ungroupAt = function (worldX, worldY) {
        SMTool.pushUndo();
        for (var i = SMData.groups.length - 1; i >= 0; i--) {
            var g = SMData.groups[i];
            var bb = SMTool._getGroupBounds(g);
            if (bb && worldX >= bb.left && worldX <= bb.right && worldY >= bb.top && worldY <= bb.bottom) {
                SMData.groups.splice(i, 1);
                document.getElementById('sbStatus').textContent = '已取消打组';
                setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 1500);
                return true;
            }
        }
        return false;
    };

    SMTool._getGroupBounds = function (g) {
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        var any = false;
        g.nodeIds.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (!n) return;
            any = true;
            var r = SMTool._getNodeWorldRect(n);
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right);
            maxY = Math.max(maxY, r.bottom);
        });
        return any ? { left: minX, top: minY, right: maxX, bottom: maxY } : null;
    };

    SMTool._findGroupOf = function (nodeId) {
        for (var i = 0; i < SMData.groups.length; i++) {
            if (SMData.groups[i].nodeIds.has(nodeId)) return SMData.groups[i];
        }
        return null;
    };

    // 追溯组的"源头"节点（组内无来自组内其他节点入边的 Spine 节点，即连线流起始点）
    SMTool._findGroupSource = function (grp) {
        var groupIds = new Set(grp.nodeIds);
        var hasIncoming = {};
        grp.nodeIds.forEach(function (nid) { hasIncoming[nid] = false; });
        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            if (groupIds.has(c.toNode) && groupIds.has(c.fromNode) && c.fromNode !== c.toNode) {
                hasIncoming[c.toNode] = true;
            }
        }
        // 找第一个无入边的 spine 节点
        var nodesArr = [];
        grp.nodeIds.forEach(function (nid) {
            var n = SMData.nodes.get(nid);
            if (n && !hasIncoming[nid] && n.nodeType === 'spine') nodesArr.push(n);
        });
        if (nodesArr.length > 0) return nodesArr[0];
        // 兜底：返回组内任意 spine 节点
        var nodesIter2 = grp.nodeIds.values();
        var r2 = nodesIter2.next();
        while (!r2.done) {
            var n2 = SMData.nodes.get(r2.value);
            if (n2 && n2.nodeType === 'spine') return n2;
            r2 = nodesIter2.next();
        }
        return null;
    };

    SMTool._renderGroupBoxes = function (ctx) {
        SMData._groupTitleRects = [];

        // ================================================================
        //  第一遍：计算所有组的排序索引（按 Y 高度排序，同行按 X 排序）
        // ================================================================
        var groupBounds = [];    // [{ g, bb }]
        for (var i = 0; i < SMData.groups.length; i++) {
            var g = SMData.groups[i];
            var bb = SMTool._getGroupBounds(g);
            if (bb) groupBounds.push({ g: g, bb: bb });
        }
        // 按 top 排序，top 相同按 left
        groupBounds.sort(function (a, b) {
            var dY = a.bb.top - b.bb.top;
            if (Math.abs(dY) < 0.5) return a.bb.left - b.bb.left;
            return dY;
        });

        // 分配排序索引：同行（top 差 < 50 世界单位）共享基数，按 left 递增后缀
        var sortIndexMap = {};   // groupId → "1" | "1_2" | ...
        var currentBase = 0;
        var currentBaseTop = -Infinity;
        var sameRowCount = 0;
        var SAME_ROW_THRESHOLD = 50; // 世界单位，Y 差在此范围内视为同行

        for (var si = 0; si < groupBounds.length; si++) {
            var item = groupBounds[si];
            var top = item.bb.top;
            if (si === 0 || Math.abs(top - currentBaseTop) > SAME_ROW_THRESHOLD) {
                // 新的一行
                currentBase++;
                currentBaseTop = top;
                sameRowCount = 1;
                sortIndexMap[item.g.id] = '' + currentBase;
            } else {
                // 同行
                sameRowCount++;
                sortIndexMap[item.g.id] = currentBase + '_' + sameRowCount;
            }
        }

        // ================================================================
        //  第二遍：渲染组边框 + 标题 + 排序索引
        // ================================================================
        for (var i2 = 0; i2 < SMData.groups.length; i2++) {
            var g = SMData.groups[i2];
            var bb = SMTool._getGroupBounds(g);
            if (!bb) continue;
            var tl = SMTool.worldToCanvas(bb.left, bb.top);
            var br = SMTool.worldToCanvas(bb.right, bb.bottom);

            // 组虚线边框
            ctx.save();
            ctx.strokeStyle = g.color;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.restore();

            // ★ 组大标题 + 排序索引 badge
            var title = g.title || '';
            var sortIdx = sortIndexMap[g.id] || '';
            if (title || sortIdx) {
                var z = SMData.view.zoom;
                // 主标题字号（随缩放，最小 28px 确保一直响应缩放）
                var titleFontSize = Math.max(28, Math.round(120 * z));
                if (titleFontSize > 240) titleFontSize = 240;
                // 排序索引字号（随缩放，最小 12px）
                var idxFontSize = Math.max(12, Math.round(40 * z));

                ctx.save();
                ctx.font = 'bold ' + titleFontSize + 'px "Segoe UI",system-ui,sans-serif';
                var textW = title ? ctx.measureText(title).width : 0;
                var idxTextW = 0;
                if (sortIdx) {
                    ctx.font = 'bold ' + idxFontSize + 'px "Segoe UI",system-ui,sans-serif';
                    idxTextW = ctx.measureText(sortIdx).width;
                }
                ctx.font = 'bold ' + titleFontSize + 'px "Segoe UI",system-ui,sans-serif';

                var padX = Math.round(16 * z);
                var padY = Math.round(8 * z);
                var titleLineH = Math.round(titleFontSize * 1.3);
                var idxLineH = sortIdx ? Math.round(idxFontSize * 1.5) : 0;
                var totalTitleH = idxLineH + titleLineH + padY;

                // 标题整体背景位置
                var titleX = tl.x - padX;
                var titleY = tl.y - totalTitleH - padY - 20;

                var contentW = Math.max(textW, idxTextW);
                var titleW = contentW + padX * 2;

                // 半透明背景（无左侧色条）
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                SMTool._roundRect(ctx, titleX, titleY, titleW, totalTitleH, Math.round(10 * z));
                ctx.fill();

                // ---- 排序索引（小字，置顶，随缩放） ----
                if (sortIdx) {
                    ctx.font = 'bold ' + idxFontSize + 'px "Segoe UI",system-ui,sans-serif';
                    ctx.fillStyle = g.color;
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    var idxX = titleX + padX + Math.round(8 * z);
                    var idxY = titleY + Math.round(4 * z);
                    ctx.fillText(sortIdx, idxX, idxY);
                }

                // ---- 主标题文字 ----
                if (title) {
                    ctx.font = 'bold ' + titleFontSize + 'px "Segoe UI",system-ui,sans-serif';
                    ctx.fillStyle = '#ffffff';
                    ctx.textBaseline = 'middle';
                    ctx.textAlign = 'left';
                    var textX = titleX + padX + Math.round(8 * z);
                    var textY = titleY + idxLineH + titleLineH / 2;
                    ctx.fillText(title, textX, textY);
                }

                ctx.restore();

                // 存储标题区域用于双击编辑
                SMData._groupTitleRects.push({
                    groupId: g.id,
                    x: titleX, y: titleY, w: titleW, h: totalTitleH
                });
            }
        }
    };

    // ★ 更新组标题文本
    SMTool._updateGroupTitle = function (groupId, text) {
        for (var i = 0; i < SMData.groups.length; i++) {
            if (SMData.groups[i].id === groupId) {
                SMData.groups[i].title = text;
                return;
            }
        }
    };

    // ★ 显示组标题浮层编辑器（双击组标题时调用）
    SMTool._showGroupTitleEditor = function (groupId, cx, cy, cw, ch, currentText) {
        // 移除已有的编辑器
        var oldEd = document.getElementById('groupTitleEditor');
        if (oldEd) oldEd.remove();

        var ed = document.createElement('input');
        ed.id = 'groupTitleEditor';
        ed.type = 'text';
        ed.value = currentText;
        ed.style.cssText =
            'position:fixed;z-index:300;background:#1c1c20;color:#fff;border:2px solid #4a9eff;' +
            'border-radius:8px;padding:4px 12px;font-size:' + Math.round(ch * 0.7) + 'px;' +
            'font-weight:bold;font-family:"Segoe UI",system-ui,sans-serif;' +
            'left:' + cx + 'px;top:' + cy + 'px;' +
            'width:' + Math.max(cw, 100) + 'px;height:' + ch + 'px;' +
            'outline:none;text-align:left;min-width:100px';
        document.body.appendChild(ed);
        ed.focus();
        ed.select();

        var save = function () {
            var val = ed.value.trim();
            if (val) SMTool._updateGroupTitle(groupId, val);
            ed.remove();
        };

        ed.addEventListener('blur', save);
        ed.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); save(); }
            if (ev.key === 'Escape') { ed.value = currentText; ed.blur(); }
        });
    };

    // ---- 渲染模式切换 ----
    SMTool.setRenderMode = function (mode) {
        SMData.renderMode = mode;
        var elS = document.getElementById('modeStatic');
        var elP = document.getElementById('modePerf');
        var elD = document.getElementById('modeDyn');
        if (elS) elS.classList.toggle('active', mode === 'static');
        if (elP) elP.classList.toggle('active', mode === 'perf');
        if (elD) elD.classList.toggle('active', mode === 'dyn');
    };

    // ---- 文本节点创建 ----
    SMTool.createShortTextNode = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'shortText';
        node.name = '条件';
        node.x = wx; node.y = wy;
        node.width = 200;
        node._textContent = '';
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    SMTool.createTextBoxNode = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'textBox';
        node.name = '文本框';
        node.x = wx; node.y = wy;
        node.width = 300;
        node._textContent = '';
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    // ---- 入口/出口节点创建 ----
    SMTool.addEntryNode = function () {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'entry';
        node.name = '入口';
        node.x = Math.random() * 200 - 100 + window.innerWidth / 2;
        node.y = Math.random() * 200 - 100 + window.innerHeight / 2;
        node.width = 260;
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    SMTool.addExitNode = function () {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'exit';
        node.name = '出口';
        node.x = Math.random() * 200 - 100 + window.innerWidth / 2;
        node.y = Math.random() * 200 - 100 + window.innerHeight / 2;
        node.width = 300;
        node._exitText = '';
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    // 在指定位置添加入口/出口节点
    SMTool.addEntryNodeAt = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'entry';
        node.name = '阶段号';
        node.x = wx; node.y = wy;
        node.width = 260;
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    SMTool.addExitNodeAt = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'exit';
        node.name = '出口';
        node.x = wx; node.y = wy;
        node.width = 300;
        node._exitText = '';
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    // ★ 延时器节点创建
    SMTool.addDelayerNode = function () {
        SMTool.addDelayerNodeAt(
            Math.random() * 200 - 100 + window.innerWidth / 2,
            Math.random() * 200 - 100 + window.innerHeight / 2
        );
    };

    SMTool.addDelayerNodeAt = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'delayer';
        node.name = '延时器';
        node.x = wx; node.y = wy;
        node.width = 280;
        node._delayValue = 1.0;
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    SMTool.addHiderNodeAt = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'hider';
        node.name = '隐藏器';
        node.x = wx; node.y = wy;
        node.width = 280;
        node._hideValue = -1;
        node._hideDirection = 'left';
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    // ★ 大循环播放节点
    SMTool.addLoopNode = function () {
        SMTool.addLoopNodeAt(
            Math.random() * 200 - 100 + window.innerWidth / 2,
            Math.random() * 200 - 100 + window.innerHeight / 2
        );
    };
    SMTool.addLoopNodeAt = function (wx, wy) {
        SMTool.pushUndo();
        var id = SMData.nextId++;
        var node = new SpineNodeData(id);
        node.nodeType = 'loop';
        node.name = '大循环播放';
        node.x = wx; node.y = wy;
        node.width = 280;
        SMData.nodes.set(id, node);
        SMTool._createEl(node);
        SMTool._updatePos(node);
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(id);
        SMData.selectedNode = id;
        SMTool._updateSel();
        SMTool._updateSB();
    };

    SMTool.ctxAddDelayer = function () {
        var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
        SMTool.addDelayerNodeAt(wp.x, wp.y);
        document.getElementById('ctxMenu').style.display = 'none';
    };

    // 右键菜单：添加入口/出口
    SMTool.ctxAddEntry = function () {
        var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
        SMTool.addEntryNodeAt(wp.x, wp.y);
        document.getElementById('ctxMenu').style.display = 'none';
    };

    SMTool.ctxAddExit = function () {
        var wp = SMTool.canvasToWorld(window.innerWidth / 2, window.innerHeight / 2);
        SMTool.addExitNodeAt(wp.x, wp.y);
        document.getElementById('ctxMenu').style.display = 'none';
    };

    // ---- 撤销/重做系统 ----

    // 生成当前状态的快照（仅序列化必要字段）
    SMTool._snapshotState = function () {
        console.log('[Snapshot] Called. _isUndoRedo=' + SMData._isUndoRedo + ' stackDepth=' + SMData._undoStack.length);
        var snap = {
            v: 1, // 快照版本
            nodes: [],
            connections: [],
            groups: [],
            nextId: SMData.nextId,
            nextConnId: SMData.nextConnId,
            nextGroupId: SMData.nextGroupId,
            renderMode: SMData.renderMode,
            flowMode: SMData.flowMode,
            _boneLabelStore: SMData._boneLabelStore ? JSON.parse(JSON.stringify(SMData._boneLabelStore)) : {}
        };

        // 序列化连线
        for (var i = 0; i < SMData.connections.length; i++) {
            var c = SMData.connections[i];
            snap.connections.push({
                id: c.id,
                fromNode: c.fromNode,
                fromState: c.fromState,
                toNode: c.toNode,
                toState: c.toState,
                condition: c.condition || '',
                cp1x: c.cp1x !== undefined ? c.cp1x : 50,
                cp1y: c.cp1y !== undefined ? c.cp1y : 0,
                cp2x: c.cp2x !== undefined ? c.cp2x : -50,
                cp2y: c.cp2y !== undefined ? c.cp2y : 0,
                color: c.color || '',
                _layerNum: c._layerNum,  // ★ 层级节点独占连线层号
                _hideLabel: !!c._hideLabel  // ★ 条件框隐藏标记
            });
        }

        // 序列化节点
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        var nodeCount = 0;
        // 源数据引用缓存（避免每份快照复制 base64 图片等大块数据）
        if (!SMData._srcCache) SMData._srcCache = {};
        try {
        while (!result.done) {
            var n = result.value;
            nodeCount++;
            // 将源数据存入全局缓存，快照中只存引用 key
            var srcKey = null;
            if (n._srcTexDataUrl || n._srcAtlasText || n._srcSkelJson || n._srcSkelBinBase64) {
                srcKey = n.sourceFile + '|' + (n._srcType || '') + '|' + (n.version || '');
                if (!SMData._srcCache[srcKey]) {
                    SMData._srcCache[srcKey] = {
                        _srcSkelJson: n._srcSkelJson || null,
                        _srcSkelBinBase64: n._srcSkelBinBase64 || null,
                        _srcAtlasText: n._srcAtlasText || '',
                        _srcTexDataUrl: n._srcTexDataUrl || '',
                        _srcType: n._srcType || '',
                        _srcFileNames: n._srcFileNames ? n._srcFileNames.slice() : []
                    };
                }
            }
            snap.nodes.push({
                id: n.id,
                name: n.name,
                nodeType: n.nodeType || 'spine',
                x: n.x,
                y: n.y,
                width: n.width || 300,
                sourceFile: n.sourceFile || '',
                animations: n.animations ? n.animations.slice() : [],
                skins: n.skins ? n.skins.slice() : [],
                slots: n.slots ? n.slots.slice() : [],
                bones: n.bones ? n.bones.slice() : [],
                version: n.version || '',
                currentAnim: n.currentAnim || '',
                currentSkin: n.currentSkin || '',
                premultipliedAlpha: !!n.premultipliedAlpha,
                loop: n.loop !== undefined ? n.loop : true,
                tracks: n.tracks ? JSON.parse(JSON.stringify(n.tracks)) : [],
                _trackMode: n._trackMode || false,
                _trackName: n._trackName || '轨道动画',
                _trackSequence: n._trackSequence ? JSON.parse(JSON.stringify(n._trackSequence)) : [],
                _mixTable: n._mixTable ? JSON.parse(JSON.stringify(n._mixTable)) : {},
                _srcKey: srcKey,   // 源数据引用 key，不再复制大块数据
                _boneTags: n._boneTags ? JSON.parse(JSON.stringify(n._boneTags)) : {},
                _boneNotes: n._boneNotes ? JSON.parse(JSON.stringify(n._boneNotes)) : {},
                // 快照中将 shotId 转回 dataUrl，确保 undo/redo 不依赖 _shotStore 生命周期
                _boneScreenshots: n._boneScreenshots ? SMTool._serializeShots(n._boneScreenshots) : {},
                _boneShotRefs: n._boneShotRefs ? JSON.parse(JSON.stringify(n._boneShotRefs)) : {},
                _stateDesc: n._stateDesc || '',
                _exitText: n._exitText || '',
                _textContent: n._textContent || '',
                _lineBreakPositions: n._lineBreakPositions ? n._lineBreakPositions.slice() : [],  // ★ 标题节点换行位置
                _loopMode: n._loopMode || null,
                _loopCount: n._loopCount !== undefined ? n._loopCount : 1,
                _loopTime: n._loopTime !== undefined ? n._loopTime : null,
                _customScale: n._customScale !== undefined ? n._customScale : 1.0,
                _playbackSpeed: n._playbackSpeed !== undefined ? n._playbackSpeed : 1.0,
                _debugOffsetX: n._debugOffsetX || 0,
                _debugOffsetY: n._debugOffsetY || 0,
                _debugCanvasW: n._debugCanvasW || 0,
                _debugCanvasH: n._debugCanvasH || 0,
                infoCollapsed: !!n.infoCollapsed,
                // ★ 图片节点数据
                _imageDataUrl: n._imageDataUrl || '',
                // ★ 节点面板右上角图片附件
                _nodeImages: n._nodeImages ? n._nodeImages.slice() : [],
                _nodeShotRefs: n._nodeShotRefs ? n._nodeShotRefs.slice() : [],
                // ★ 层级节点数据
                _layerData: n._layerData ? JSON.parse(JSON.stringify(n._layerData)) : null
            });
            result = nodesIter.next();
        }
        } catch (e) {
            console.error('[Snapshot] Error serializing node #' + nodeCount + ':', e);
        }
        console.log('[Snapshot] Captured ' + snap.nodes.length + ' nodes (iterated ' + nodeCount + ')');

        // 序列化分组
        for (var g = 0; g < SMData.groups.length; g++) {
            var grp = SMData.groups[g];
            var nodeIdArr = [];
            if (grp.nodeIds) {
                grp.nodeIds.forEach(function (nid) { nodeIdArr.push(nid); });
            }
            snap.groups.push({
                id: grp.id,
                nodeIds: nodeIdArr,
                color: grp.color,
                title: grp.title || ''
            });
        }

        return snap;
    };

    // 从快照恢复状态（增量更新，保留 WebGL 资源避免闪烁）
    SMTool._restoreState = function (snap) {
        var nodeList = snap.nodes || [];
        var snapNodeIds = new Set();
        var snapNodeMap = {};
        for (var i = 0; i < nodeList.length; i++) {
            snapNodeIds.add(nodeList[i].id);
            snapNodeMap[nodeList[i].id] = nodeList[i];
        }

        // ---- 1. 删除不在快照中的节点 ----
        var toDelete = [];
        SMData.nodes.forEach(function (_n, nid) {
            if (!snapNodeIds.has(nid)) toDelete.push(nid);
        });
        for (var d = 0; d < toDelete.length; d++) {
            var nid = toDelete[d];
            var delNode = SMData.nodes.get(nid);
            if (delNode) {
                if (delNode.state) { try { delNode.state.clearTracks(); } catch (e) {} }
                SMTool._releaseNodeTextures(delNode);
                if (delNode.batcher) { try { delNode.batcher.dispose(); } catch (e) {} delNode.batcher = null; }
                if (delNode.shader) { try { delNode.shader.dispose(); } catch (e) {} delNode.shader = null; }
                if (delNode.skeletonRenderer) { try { delNode.skeletonRenderer.dispose(); } catch (e) {} delNode.skeletonRenderer = null; }
                if (delNode.sceneRenderer) { try { delNode.sceneRenderer.dispose(); } catch (e) {} delNode.sceneRenderer = null; }
            }
            var el = SMTool._getEl(nid);
            if (el) el.remove();
            SMData.nodes.delete(nid);
        }

        // ---- 2. 更新现有节点 / 创建新节点 ----
        for (var j = 0; j < nodeList.length; j++) {
            var nd = nodeList[j];
            var existing = SMData.nodes.get(nd.id);

            if (existing) {
                // --- 增量更新现有节点（保留 WebGL 资源） ---

                // 检测源数据是否发生实质性变化（比较缓存 key）
                var newSrcKey = nd._srcKey || '';
                var oldSrcKey = (existing.sourceFile || '') + '|' + (existing._srcType || '') + '|' + (existing.version || '');
                var srcChanged = !!(nd._srcKey) && (newSrcKey !== oldSrcKey || !existing.skeleton);

                // 检测节点类型是否变化（需要重建 DOM）
                var typeChanged = (existing.nodeType !== (nd.nodeType || 'spine'));

                // 更新元数据
                existing.name = nd.name;
                existing.x = nd.x || 0;
                existing.y = nd.y || 0;
                existing.width = nd.width || 300;
                existing.sourceFile = nd.sourceFile || '';
                existing.animations = nd.animations || [];
                existing.skins = nd.skins || [];
                existing.slots = nd.slots || [];
                existing.bones = nd.bones || [];
                existing.version = nd.version || '';
                existing.premultipliedAlpha = !!nd.premultipliedAlpha;
                existing.loop = nd.loop !== undefined ? nd.loop : true;
                existing.tracks = nd.tracks || [];
                existing._trackMode = nd._trackMode || false;
                existing._trackName = nd._trackName || '轨道动画';
                existing._trackSequence = nd._trackSequence || [];
                existing._mixTable = nd._mixTable || {};
                // 从缓存恢复源数据（仅当 key 变化时才更新）
                SMTool._applySrcCache(existing, nd._srcKey);
                existing._boneTags = nd._boneTags || {};
                existing._boneNotes = nd._boneNotes || {};
                existing._boneScreenshots = nd._boneScreenshots || {};
                // 兼容旧数据（单图转数组，字符串转 shotId）
                if (existing._boneScreenshots) {
                    var boneNames = Object.keys(existing._boneScreenshots);
                    for (var bi = 0; bi < boneNames.length; bi++) {
                        var bn = boneNames[bi];
                        if (existing._boneScreenshots[bn] && !Array.isArray(existing._boneScreenshots[bn])) {
                            existing._boneScreenshots[bn] = [existing._boneScreenshots[bn]];
                        }
                        // 旧格式 dataUrl 字符串 → 注册到全局表转为 shotId
                        var shotArr = existing._boneScreenshots[bn];
                        if (Array.isArray(shotArr)) {
                            for (var sai = 0; sai < shotArr.length; sai++) {
                                if (typeof shotArr[sai] === 'string' && shotArr[sai].indexOf('data:image/') === 0) {
                                    shotArr[sai] = SMData._shotRegister(shotArr[sai]);
                                }
                            }
                        }
                    }
                }
                existing._boneShotRefs = nd._boneShotRefs || {};
                existing._boneFade = nd._boneFade || {};
                // ★ 皮肤标记/备注/截图/淡入淡出
                existing._skinTags = nd._skinTags || {};
                existing._skinNotes = nd._skinNotes || {};
                existing._skinFade = nd._skinFade || {};
                existing._skinScreenshots = nd._skinScreenshots || {};
                if (existing._skinScreenshots) {
                    var skinNames2 = Object.keys(existing._skinScreenshots);
                    for (var bj = 0; bj < skinNames2.length; bj++) {
                        var snk = skinNames2[bj];
                        if (existing._skinScreenshots[snk] && !Array.isArray(existing._skinScreenshots[snk])) {
                            existing._skinScreenshots[snk] = [existing._skinScreenshots[snk]];
                        }
                        var shotArr2 = existing._skinScreenshots[snk];
                        if (Array.isArray(shotArr2)) {
                            for (var sai2 = 0; sai2 < shotArr2.length; sai2++) {
                                if (typeof shotArr2[sai2] === 'string' && shotArr2[sai2].indexOf('data:image/') === 0) {
                                    shotArr2[sai2] = SMData._shotRegister(shotArr2[sai2]);
                                }
                            }
                        }
                    }
                }
                existing._skinShotRefs = nd._skinShotRefs || {};
                // ★ 插槽标记/备注/截图/淡入淡出
                existing._slotTags = nd._slotTags || {};
                existing._slotNotes = nd._slotNotes || {};
                existing._slotFade = nd._slotFade || {};
                existing._slotScreenshots = nd._slotScreenshots || {};
                if (existing._slotScreenshots) {
                    var slotNames2 = Object.keys(existing._slotScreenshots);
                    for (var bk = 0; bk < slotNames2.length; bk++) {
                        var slk = slotNames2[bk];
                        if (existing._slotScreenshots[slk] && !Array.isArray(existing._slotScreenshots[slk])) {
                            existing._slotScreenshots[slk] = [existing._slotScreenshots[slk]];
                        }
                        var shotArr3 = existing._slotScreenshots[slk];
                        if (Array.isArray(shotArr3)) {
                            for (var sai3 = 0; sai3 < shotArr3.length; sai3++) {
                                if (typeof shotArr3[sai3] === 'string' && shotArr3[sai3].indexOf('data:image/') === 0) {
                                    shotArr3[sai3] = SMData._shotRegister(shotArr3[sai3]);
                                }
                            }
                        }
                    }
                }
                existing._slotShotRefs = nd._slotShotRefs || {};
                existing._stateDesc = nd._stateDesc || '';
                existing._exitText = nd._exitText || '';
                existing._textContent = nd._textContent || '';
                existing._lineBreakPositions = nd._lineBreakPositions ? nd._lineBreakPositions.slice() : [];  // ★ 恢复标题节点换行位置
                existing._loopMode = nd._loopMode || null;
                existing._loopCount = (nd._loopCount !== undefined) ? nd._loopCount : 1;
                existing._loopTime = (nd._loopTime !== undefined) ? nd._loopTime : null;
                existing._customScale = nd._customScale !== undefined ? nd._customScale : 1.0;
                existing._playbackSpeed = nd._playbackSpeed !== undefined ? nd._playbackSpeed : 1.0;
                existing._debugOffsetX = nd._debugOffsetX || 0;
                existing._debugOffsetY = nd._debugOffsetY || 0;
                existing._debugCanvasW = nd._debugCanvasW || 0;
                existing._debugCanvasH = nd._debugCanvasH || 0;
                existing.infoCollapsed = !!nd.infoCollapsed;
                // ★ 图片节点数据
                existing._imageDataUrl = nd._imageDataUrl || '';
                // ★ 节点面板右上角图片附件
                existing._nodeImages = nd._nodeImages || [];
                existing._nodeShotRefs = nd._nodeShotRefs || [];
                // ★ 恢复层级节点数据
                if (nd._layerData) existing._layerData = JSON.parse(JSON.stringify(nd._layerData));
                else if (nd.nodeType === 'layer') existing._layerData = { layerCount: 2, layers: {} };

                // 更新动画（即时切换，无需重载）
                if (existing.state && existing.currentAnim !== (nd.currentAnim || '')) {
                    try {
                        if (!existing.tracks || existing.tracks.length === 0) SMTool._initDefaultTracks(existing);
                        existing.tracks[0].animName = nd.currentAnim || '';
                        SMTool._applyTracksToState(existing);
                    } catch (e) { /* 忽略 */ }
                }
                existing.currentAnim = nd.currentAnim || '';

                // 更新皮肤（即时切换）
                if (existing.skeleton && nd.currentSkin && existing.currentSkin !== nd.currentSkin) {
                    var sd = existing.skeletonData;
                    if (sd) {
                        for (var si = 0; si < sd.skins.length; si++) {
                            if (sd.skins[si].name === nd.currentSkin) {
                                try { existing.skeleton.setSkin(sd.skins[si]); existing.skeleton.setSlotsToSetupPose(); } catch (e) {}
                                break;
                            }
                        }
                    }
                }
                existing.currentSkin = nd.currentSkin || '';

                // 节点类型变了 → 重建 DOM
                if (typeChanged) {
                    var oldEl = SMTool._getEl(existing.id);
                    if (oldEl) oldEl.remove();
                    existing.nodeType = nd.nodeType || 'spine';
                    SMTool._createEl(existing);
                }

                // 源数据变了 → 重新加载 WebGL（罕见）
                if (srcChanged) {
                    if (existing.state) { try { existing.state.clearTracks(); } catch (e) {} }
                    SMTool._releaseNodeTextures(existing);
                    if (existing.batcher) { try { existing.batcher.dispose(); } catch (e) {} }
                    if (existing.shader) { try { existing.shader.dispose(); } catch (e) {} }
                    if (existing.sceneRenderer) { try { existing.sceneRenderer.dispose(); } catch (e) {} }
                    existing.skeletonData = null;
                    existing.atlasData = null;
                    existing.skeleton = null;
                    existing.state = null;
                    existing.batcher = null;
                    existing.shader = null;
                    existing.sceneRenderer = null;
                    existing.glTextures = [];
                    if (existing._srcAtlasText && existing._srcTexDataUrl &&
                        (existing._srcSkelJson || existing._srcSkelBinBase64)) {
                        (function (n) {
                            SMTool._loadFromSourceData(n).then(function () {
                                SMTool._updateEl(n);
                            }).catch(function (err) {
                                console.error('[Undo/Redo] Failed to reload source:', err);
                            });
                        })(existing);
                    }
                }

                // 刷新 DOM 显示
                SMTool._updateEl(existing);
                SMTool._updatePos(existing);

            } else {
                // --- 创建全新节点 ---
                var node = new SpineNodeData(nd.id);
                node.name = nd.name;
                node.nodeType = nd.nodeType || 'spine';
                node.x = nd.x || 0;
                node.y = nd.y || 0;
                node.width = nd.width || 300;
                node.sourceFile = nd.sourceFile || '';
                node.animations = nd.animations || [];
                node.skins = nd.skins || [];
                node.slots = nd.slots || [];
                node.bones = nd.bones || [];
                node.version = nd.version || '';
                node.currentAnim = nd.currentAnim || '';
                node.currentSkin = nd.currentSkin || '';
                node.premultipliedAlpha = !!nd.premultipliedAlpha;
                node.loop = nd.loop !== undefined ? nd.loop : true;
                node.tracks = nd.tracks || [];
                node._trackMode = nd._trackMode || false;
                node._trackName = nd._trackName || '轨道动画';
                node._trackSequence = nd._trackSequence || [];
                node._mixTable = nd._mixTable || {};
                // 从缓存恢复源数据
                SMTool._applySrcCache(node, nd._srcKey);
                node._boneTags = nd._boneTags || {};
                node._boneNotes = nd._boneNotes || {};
                node._boneScreenshots = nd._boneScreenshots || {};
                // 兼容旧数据（单图转数组，字符串转 shotId）
                if (node._boneScreenshots) {
                    var bnKeys = Object.keys(node._boneScreenshots);
                    for (var bj = 0; bj < bnKeys.length; bj++) {
                        var bnk = bnKeys[bj];
                        if (node._boneScreenshots[bnk] && !Array.isArray(node._boneScreenshots[bnk])) {
                            node._boneScreenshots[bnk] = [node._boneScreenshots[bnk]];
                        }
                        var shotArr2 = node._boneScreenshots[bnk];
                        if (Array.isArray(shotArr2)) {
                            for (var saj = 0; saj < shotArr2.length; saj++) {
                                if (typeof shotArr2[saj] === 'string' && shotArr2[saj].indexOf('data:image/') === 0) {
                                    shotArr2[saj] = SMData._shotRegister(shotArr2[saj]);
                                }
                            }
                        }
                    }
                }
                node._boneShotRefs = nd._boneShotRefs || {};
                node._boneFade = nd._boneFade || {};
                // ★ 皮肤标记/备注/截图/淡入淡出
                node._skinTags = nd._skinTags || {};
                node._skinNotes = nd._skinNotes || {};
                node._skinFade = nd._skinFade || {};
                node._skinScreenshots = nd._skinScreenshots || {};
                if (node._skinScreenshots) {
                    var sknKeys = Object.keys(node._skinScreenshots);
                    for (var bj2 = 0; bj2 < sknKeys.length; bj2++) {
                        var sknk = sknKeys[bj2];
                        if (node._skinScreenshots[sknk] && !Array.isArray(node._skinScreenshots[sknk])) {
                            node._skinScreenshots[sknk] = [node._skinScreenshots[sknk]];
                        }
                        var shotArr3 = node._skinScreenshots[sknk];
                        if (Array.isArray(shotArr3)) {
                            for (var saj2 = 0; saj2 < shotArr3.length; saj2++) {
                                if (typeof shotArr3[saj2] === 'string' && shotArr3[saj2].indexOf('data:image/') === 0) {
                                    shotArr3[saj2] = SMData._shotRegister(shotArr3[saj2]);
                                }
                            }
                        }
                    }
                }
                node._skinShotRefs = nd._skinShotRefs || {};
                // ★ 插槽标记/备注/截图/淡入淡出
                node._slotTags = nd._slotTags || {};
                node._slotNotes = nd._slotNotes || {};
                node._slotFade = nd._slotFade || {};
                node._slotScreenshots = nd._slotScreenshots || {};
                if (node._slotScreenshots) {
                    var slnKeys = Object.keys(node._slotScreenshots);
                    for (var bj3 = 0; bj3 < slnKeys.length; bj3++) {
                        var slnk = slnKeys[bj3];
                        if (node._slotScreenshots[slnk] && !Array.isArray(node._slotScreenshots[slnk])) {
                            node._slotScreenshots[slnk] = [node._slotScreenshots[slnk]];
                        }
                        var shotArr4 = node._slotScreenshots[slnk];
                        if (Array.isArray(shotArr4)) {
                            for (var saj3 = 0; saj3 < shotArr4.length; saj3++) {
                                if (typeof shotArr4[saj3] === 'string' && shotArr4[saj3].indexOf('data:image/') === 0) {
                                    shotArr4[saj3] = SMData._shotRegister(shotArr4[saj3]);
                                }
                            }
                        }
                    }
                }
                node._slotShotRefs = nd._slotShotRefs || {};
                node._stateDesc = nd._stateDesc || '';
                node._exitText = nd._exitText || '';
                node._textContent = nd._textContent || '';
                node._lineBreakPositions = nd._lineBreakPositions ? nd._lineBreakPositions.slice() : [];  // ★ 恢复标题节点换行位置
                node._loopMode = nd._loopMode || null;
                node._loopCount = (nd._loopCount !== undefined) ? nd._loopCount : 1;
                node._loopTime = (nd._loopTime !== undefined) ? nd._loopTime : null;
                node._customScale = nd._customScale !== undefined ? nd._customScale : 1.0;
                node._playbackSpeed = nd._playbackSpeed !== undefined ? nd._playbackSpeed : 1.0;
                node._debugOffsetX = nd._debugOffsetX || 0;
                node._debugOffsetY = nd._debugOffsetY || 0;
                node._debugCanvasW = nd._debugCanvasW || 0;
                node._debugCanvasH = nd._debugCanvasH || 0;
                node.infoCollapsed = !!nd.infoCollapsed;
                // ★ 图片节点数据
                node._imageDataUrl = nd._imageDataUrl || '';
                // ★ 节点面板右上角图片附件
                node._nodeImages = nd._nodeImages || [];
                node._nodeShotRefs = nd._nodeShotRefs || [];
                // ★ 恢复层级节点数据
                if (nd._layerData) node._layerData = JSON.parse(JSON.stringify(nd._layerData));
                else if (nd.nodeType === 'layer') node._layerData = { layerCount: 2, layers: {} };

                SMData.nodes.set(nd.id, node);
                SMTool._createEl(node);
                SMTool._updatePos(node);

                if (node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
                    (node._srcSkelJson || node._srcSkelBinBase64)) {
                    (function (n) {
                        SMTool._loadFromSourceData(n).then(function () {
                            SMTool._updateEl(n);
                        }).catch(function (err) {
                            console.error('[Undo/Redo] Failed to load new node:', err);
                        });
                    })(node);
                }
            }
        }

        // ---- 3. 恢复 ID 计数器和全局设置 ----
        SMData.nextId = snap.nextId;
        SMData.nextConnId = snap.nextConnId;
        SMData.nextGroupId = snap.nextGroupId || 1;
        if (snap.renderMode) SMData.renderMode = snap.renderMode;
        if (snap.flowMode) SMData.flowMode = snap.flowMode;
        if (snap._boneLabelStore) SMData._boneLabelStore = snap._boneLabelStore;

        // ---- 4. 恢复连线（直接替换数组，canvas 绘制） ----
        SMData.connections = (snap.connections || []).map(function (c) {
            return {
                id: c.id,
                fromNode: c.fromNode,
                fromState: c.fromState,
                toNode: c.toNode,
                toState: c.toState,
                condition: c.condition || '',
                cp1x: c.cp1x,
                cp1y: c.cp1y,
                cp2x: c.cp2x,
                cp2y: c.cp2y,
                color: c.color || '',
                _layerNum: c._layerNum,  // ★ 层级节点独占连线层号
                _hideLabel: !!c._hideLabel  // ★ 条件框隐藏标记
            };
        });

        // ---- 5. 恢复分组 ----
        SMData.groups = (snap.groups || []).map(function (g) {
            return {
                id: g.id,
                nodeIds: new Set(g.nodeIds || []),
                color: g.color,
                title: g.title || ''
            };
        });

        // ---- 6. 清除选中/交互状态 ----
        SMData.selectedNode = null;
        SMData.selectedNodes.clear();
        SMData.selectedConnection = null;
        SMData.draggedNode = null;
        SMData.isMultiDragging = false;
        SMData.multiDragOffsets.clear();
        SMData.connecting = null;
        SMData.connectMode = false;
        document.getElementById('btnConnect').classList.remove('active');
        document.getElementById('conditionEditor').classList.remove('show');

        // ---- 7. 刷新 UI（轻量级刷新，不重建任何 DOM） ----
        SMData._forceRedraw = true;  // ★ 强制下次渲染循环重绘全部
        SMTool._updateAllPos(true);  // ★ 强制同步刷新所有节点 DOM 位置
        SMTool._updateSel();
        SMTool._updateSB();
        SMTool._updateStateRowColors();
        SMTool._updateDuplicateHighlights();
        SMTool._checkMissingStates();
        SMTool._refreshAllTranslations();
        SMTool._updateFlowPanel();
        SMTool._updateFloatPanel();
        // 🔒 [LOCK-L] 并行播放面板刷新及时性 — undo/redo 后必须刷新层级节点显示
        if (typeof SMTool._refreshAllLayerBoxes === 'function') SMTool._refreshAllLayerBoxes();

        // 同步模式按钮
        var elS2 = document.getElementById('modeStatic');
        var elP2 = document.getElementById('modePerf');
        var elD2 = document.getElementById('modeDyn');
        if (elS2) elS2.classList.toggle('active', SMData.renderMode === 'static');
        if (elP2) elP2.classList.toggle('active', SMData.renderMode === 'perf');
        if (elD2) elD2.classList.toggle('active', SMData.renderMode === 'dyn');
        var elFM3 = document.getElementById('flowModeThree');
        var elFMF = document.getElementById('flowModeFull');
        if (elFM3) elFM3.classList.toggle('active', SMData.flowMode === 'three');
        if (elFMF) elFMF.classList.toggle('active', SMData.flowMode === 'full');
    };

    // 压入撤销栈（在操作前调用）
    SMTool.pushUndo = function () {
        if (SMData._isUndoRedo) { console.warn('[PushUndo] BLOCKED by _isUndoRedo=true'); return; }
        var snap = SMTool._snapshotState();
        if (!snap.nodes || snap.nodes.length === 0) { console.warn('[PushUndo] SKIP empty snapshot'); return; }
        console.log('[PushUndo] snap nodes=' + snap.nodes.length + ' stackBefore=' + SMData._undoStack.length);
        // 与栈顶比对去重：状态未变则不重复压栈
        if (SMData._undoStack.length > 0) {
            var lastSnap = SMData._undoStack[SMData._undoStack.length - 1];
            if (SMTool._snapEqual(snap, lastSnap)) return;
        }
        SMData._undoStack.push(snap);
        // 限制最大步数
        while (SMData._undoStack.length > SMData._undoMaxSteps) {
            SMData._undoStack.shift();
        }
        // 清空重做栈（新操作使重做历史无效）
        SMData._redoStack = [];
    };

    // 快速比对两个快照是否相同（只比关键字段）
    SMTool._snapEqual = function (a, b) {
        if (a.nodes.length !== b.nodes.length) return false;
        if (a.connections.length !== b.connections.length) return false;
        if (a.groups.length !== b.groups.length) return false;
        // 比对节点（只比位置和动画，忽略 WebGL 资源引用）
        for (var i = 0; i < a.nodes.length; i++) {
            var na = a.nodes[i];
            var nb = b.nodes[i];
            if (!nb) return false;
            if (na.id !== nb.id) return false;
            if (na.x !== nb.x || na.y !== nb.y) return false;
            if (na.currentAnim !== nb.currentAnim) return false;
            if (na.currentSkin !== nb.currentSkin) return false;
            if (na.name !== nb.name) return false;
            if (na.nodeType !== nb.nodeType) return false;
        }
        // 比对连线
        for (var j = 0; j < a.connections.length; j++) {
            var ca = a.connections[j];
            var cb = b.connections[j];
            if (!cb) return false;
            if (ca.id !== cb.id) return false;
            if (ca.fromNode !== cb.fromNode || ca.toNode !== cb.toNode) return false;
            if (ca.fromState !== cb.fromState || ca.toState !== cb.toState) return false;
            if (ca.condition !== cb.condition) return false;
        }
        // 比对分组
        for (var k = 0; k < a.groups.length; k++) {
            var ga = a.groups[k];
            var gb = b.groups[k];
            if (!gb) return false;
            if (ga.id !== gb.id) return false;
            if (ga.nodeIds.length !== gb.nodeIds.length) return false;
            for (var gi = 0; gi < ga.nodeIds.length; gi++) {
                if (ga.nodeIds[gi] !== gb.nodeIds[gi]) return false;
            }
        }
        return true;
    };

    // 从缓存恢复源数据到节点
    SMTool._applySrcCache = function (node, srcKey) {
        if (!srcKey) return;
        var cache = SMData._srcCache;
        if (!cache || !cache[srcKey]) return;
        var c = cache[srcKey];
        node._srcSkelJson = c._srcSkelJson || null;
        node._srcSkelBinBase64 = c._srcSkelBinBase64 || null;
        node._srcAtlasText = c._srcAtlasText || '';
        node._srcTexDataUrl = c._srcTexDataUrl || '';
        node._srcType = c._srcType || '';
        node._srcFileNames = c._srcFileNames || [];
    };

    // 提交拖拽撤销快照：在拖拽/拖动结束时调用，比对起始快照决定是否压栈
    SMTool._commitDragUndo = function () {
        if (!SMData._pendingDragSnap) return;
        var endSnap = SMTool._snapshotState();
        console.log('[CommitDragUndo] pendingSnap nodes=' + SMData._pendingDragSnap.nodes.length + ' endSnap nodes=' + endSnap.nodes.length);
        if (!SMTool._snapEqual(SMData._pendingDragSnap, endSnap)) {
            // ★ 过滤空快照
            if (!SMData._pendingDragSnap.nodes || SMData._pendingDragSnap.nodes.length === 0) {
                console.warn('[CommitDragUndo] SKIP empty pendingSnap');
            } else {
                SMData._undoStack.push(SMData._pendingDragSnap);
                while (SMData._undoStack.length > SMData._undoMaxSteps) {
                    SMData._undoStack.shift();
                }
                SMData._redoStack = [];
            }
        }
        SMData._pendingDragSnap = null;
    };

    // 执行撤销
    SMTool.undo = function () {
        if (SMData._undoStack.length === 0) {
            document.getElementById('sbStatus').textContent = '无法撤销';
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 1500);
            return;
        }
        SMData._isUndoRedo = true;
        try {
            // 保存当前状态到重做栈
            var currentSnap = SMTool._snapshotState();
            SMData._redoStack.push(currentSnap);
            // 取出上一个快照恢复
            var prevSnap = SMData._undoStack.pop();
            if (!prevSnap || !prevSnap.nodes || prevSnap.nodes.length === 0) {
                console.warn('[Undo] Empty/invalid snapshot, skipping. Clearing corrupt stack entry.');
                SMData._undoStack = [];  // ★ 清空整栈防止后续 undo 也崩
                SMData._isUndoRedo = false;
                document.getElementById('sbStatus').textContent = '无法撤销（快照损坏已修复）';
                setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
                return;
            }
            console.log('[Undo] Restoring snapshot: ' + prevSnap.nodes.length + ' nodes, ' + (prevSnap.connections || []).length + ' connections. Current nodes: ' + SMData.nodes.size + '. Undo stack depth: ' + SMData._undoStack.length);
            if (prevSnap.nodes.length === 0) {
                console.warn('[Undo] ⚠ Snapshot has 0 nodes! Check _snapshotState.');
            }
            // ★ 诊断：打印快照中每个节点的 id 和 nodeType
            for (var di = 0; di < Math.min(prevSnap.nodes.length, 5); di++) {
                console.log('[Undo]   snap node[' + di + ']: id=' + prevSnap.nodes[di].id + ' type=' + prevSnap.nodes[di].nodeType);
            }
            SMTool._restoreState(prevSnap);
            console.log('[Undo] After restore: ' + SMData.nodes.size + ' nodes in map, ' + document.querySelectorAll('.spine-node').length + ' DOM elements');
            document.getElementById('sbStatus').textContent = '已撤销 (' + SMData._undoStack.length + ' 步可撤销)';
        } catch (e) {
            console.error('[Undo] Error:', e);
            document.getElementById('sbStatus').textContent = '撤销失败: ' + (e.message || '未知错误');
        }
        SMData._isUndoRedo = false;
        setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
    };

    // 执行重做
    SMTool.redo = function () {
        if (SMData._redoStack.length === 0) {
            document.getElementById('sbStatus').textContent = '无法重做';
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 1500);
            return;
        }
        SMData._isUndoRedo = true;
        // 保存当前状态到撤销栈
        var currentSnap = SMTool._snapshotState();
        SMData._undoStack.push(currentSnap);
        // 取出重做栈快照恢复
        var nextSnap = SMData._redoStack.pop();
        SMTool._restoreState(nextSnap);
        SMData._isUndoRedo = false;
        document.getElementById('sbStatus').textContent = '已重做 (' + SMData._undoStack.length + ' 步可撤销)';
        setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
    };

    // 启动渲染循环
    SMTool._lt = performance.now();
    SMTool._fc = 0;
    SMTool._ft = performance.now();
    requestAnimationFrame(function (t) { SMTool._loop(t); });

    // 初始化左侧浮窗面板
    SMTool._initFloatPanel();
    SMTool._initBoneLabelEvents();
    SMTool._updateFloatPanel();   // 设置初始 inactive 状态 + 提示文字

    // 初始化底部动画组合浮窗面板
    SMTool._initFlowPanel();
    SMTool._updateFlowPanel();    // 设置初始 inactive 状态 + 提示文字
    SMTool.setFlowMode('full');  // 默认完整-动画流模式

    // ★ 初始化右上角动画预览浮窗面板
    SMTool._initAnimPreviewPanel();

    SMTool._updateSB();

    // ★ 强制首帧重绘连线和网格（防止数据异步加载后连线不归位）
    SMData._forceRedraw = true;

    // ★ 启动日志（设置 SMData._debugLog = false 可静默）
    if (SMData._debugLog !== false) {
        console.log('🎬 Spine Animation State Machine ready!');
        console.log('  拖拽 .zip 工程包 或 spine 文件到画布上');
        console.log('  Alt+拖拽=平移 | 滚轮=缩放 | 右键=平移');
    }

    // ================================================================
    // ★ 全局搜索功能
    // ================================================================
    SMData._searchResults = [];
    SMData._searchActiveIdx = -1;
    SMData._searchAnimId = 0;

    // 执行搜索
    SMTool._doSearch = function () {
        var input = document.getElementById('searchInput');
        var query = (input.value || '').trim();
        if (!query) {
            SMTool._clearSearch();
            return;
        }
        var qLower = query.toLowerCase();
        SMData._searchResults = [];
        SMData._searchActiveIdx = -1;

        var nodesIter = SMData.nodes.values();
        var r = nodesIter.next();
        while (!r.done) {
            var node = r.value;
            var nid = node.id;
            var fields = [
                { type: '节点名', text: node.name || '' },
                { type: '源文件', text: node.sourceFile || '' },
                { type: '当前动画', text: node.currentAnim || '' },
                { type: '状态描述', text: node._stateDesc || '' },
                { type: '文本内容', text: node._textContent || '' },
                { type: '入口/出口', text: node._exitText || '' }
            ];
            for (var ci = 0; ci < SMData.connections.length; ci++) {
                var conn = SMData.connections[ci];
                if ((conn.fromNode === nid || conn.toNode === nid) && conn.condition) {
                    fields.push({ type: '连线条件', text: conn.condition });
                }
            }
            if (node._boneTags) {
                var btKeys = Object.keys(node._boneTags);
                for (var bti = 0; bti < btKeys.length; bti++) {
                    var tags = node._boneTags[btKeys[bti]];
                    if (Array.isArray(tags)) {
                        for (var ti = 0; ti < tags.length; ti++) {
                            fields.push({ type: '骨骼标签', text: btKeys[bti] + ': ' + tags[ti] });
                        }
                    }
                }
            }
            if (node.skins) {
                for (var ski = 0; ski < node.skins.length; ski++) {
                    fields.push({ type: '皮肤', text: node.skins[ski] });
                }
            }

            for (var fi = 0; fi < fields.length; fi++) {
                var f = fields[fi];
                if (!f.text) continue;
                var idx = f.text.toLowerCase().indexOf(qLower);
                if (idx >= 0) {
                    SMData._searchResults.push({
                        nodeId: nid,
                        fieldType: f.type,
                        fullText: f.text,
                        matchStart: idx,
                        matchLen: query.length
                    });
                }
            }
            r = nodesIter.next();
        }

        SMTool._updateSearchResults();
        // ★ 高亮所有匹配节点上的匹配文本
        SMTool._clearSearchHighlights();
        var highlightedNodes = {};
        for (var ri = 0; ri < SMData._searchResults.length; ri++) {
            var nid2 = SMData._searchResults[ri].nodeId;
            if (!highlightedNodes[nid2]) {
                highlightedNodes[nid2] = true;
                SMTool._highlightNodeMatches(nid2, query);
            }
        }
        // ★ 搜索出结果时自动收起入口导航列表（互斥）
        if (SMData._searchResults.length > 0) {
            SMTool._closeEntryNav();
            SMTool._searchFocusResult(0);
        }
    };

    // 清除搜索
    SMTool._clearSearch = function () {
        SMData._searchResults = [];
        SMData._searchActiveIdx = -1;
        SMTool._clearSearchHighlights();
        var resultsEl = document.getElementById('searchResults');
        if (resultsEl) resultsEl.style.display = 'none';
        var countEl = document.getElementById('spResultCount');
        if (countEl) countEl.textContent = '';
        // ★ 同时关闭入口导航列表
        var entryList = document.getElementById('entryNavList');
        var entryBtn = document.getElementById('entryNavBtn');
        if (entryList) entryList.style.display = 'none';
        if (entryBtn) entryBtn.classList.remove('active');
        if (SMData._searchAnimId) {
            cancelAnimationFrame(SMData._searchAnimId);
            SMData._searchAnimId = 0;
        }
    };

    // 清除所有节点的高亮
    SMTool._clearSearchHighlights = function () {
        var nodesIter = SMData.nodes.values();
        var r = nodesIter.next();
        while (!r.done) {
            var el = SMTool._getEl(r.value.id);
            if (el) {
                var hls = el.querySelectorAll('.search-highlight');
                for (var i = 0; i < hls.length; i++) {
                    var parent = hls[i].parentNode;
                    if (parent) {
                        parent.replaceChild(document.createTextNode(hls[i].textContent), hls[i]);
                        parent.normalize();
                    }
                }
            }
            r = nodesIter.next();
        }
    };

    // 高亮节点中匹配的文本
    SMTool._highlightNodeMatches = function (nodeId, query) {
        if (!query) return;
        var el = SMTool._getEl(nodeId);
        if (!el) return;
        var qLower = query.toLowerCase();
        // ★ 覆盖所有可能包含匹配文本的 DOM 区域
        var nameEls = el.querySelectorAll('.name, .source-file, .state-desc, .exit-text-input, .entry-text-input, .entry-title-input, .text-box-title, .text-box-area, .layer-box-text, .title-text, .skin-badge');
        for (var ni = 0; ni < nameEls.length; ni++) {
            SMTool._highlightTextInElement(nameEls[ni], qLower);
        }
    };

    // 在 DOM 元素中高亮匹配文本
    SMTool._highlightTextInElement = function (el, qLower) {
        if (!el || !qLower) return;
        var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
        var textNodes = [];
        while (walker.nextNode()) { textNodes.push(walker.currentNode); }
        for (var i = 0; i < textNodes.length; i++) {
            var node = textNodes[i];
            var txt = node.textContent;
            var idx = txt.toLowerCase().indexOf(qLower);
            if (idx < 0) continue;
            if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains('search-highlight')) continue;
            var before = txt.substring(0, idx);
            var match = txt.substring(idx, idx + qLower.length);
            var after = txt.substring(idx + qLower.length);
            var parent = node.parentNode;
            if (!parent) continue;
            var frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            var mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = match;
            frag.appendChild(mark);
            if (after) frag.appendChild(document.createTextNode(after));
            parent.replaceChild(frag, node);
        }
    };

    // 更新搜索结果列表 UI
    SMTool._updateSearchResults = function () {
        var resultsEl = document.getElementById('searchResults');
        var listEl = document.getElementById('spResultList');
        var countEl = document.getElementById('spResultCount');
        if (!resultsEl || !listEl || !countEl) return;
        var results = SMData._searchResults;
        if (results.length === 0) {
            listEl.innerHTML = '<div class="sp-no-results">无匹配结果</div>';
            resultsEl.style.display = 'flex';
            countEl.textContent = '0 个结果';
            return;
        }
        resultsEl.style.display = 'flex';
        countEl.textContent = (SMData._searchActiveIdx + 1) + ' / ' + results.length;
        var html = '';
        for (var i = 0; i < results.length; i++) {
            var item = results[i];
            var node2 = SMData.nodes.get(item.nodeId);
            var nodeLabel = node2 ? (node2.sourceFile || node2.name || '节点#' + item.nodeId) : '节点#' + item.nodeId;
            var activeClass = (i === SMData._searchActiveIdx) ? ' active' : '';
            var start = Math.max(0, item.matchStart - 20);
            var end = Math.min(item.fullText.length, item.matchStart + item.matchLen + 25);
            var preview = (start > 0 ? '…' : '') + item.fullText.substring(start, end) + (end < item.fullText.length ? '…' : '');
            var matchInPreview = item.matchStart - start;
            html += '<div class="sp-result-item' + activeClass + '" onclick="SMTool._searchFocusResult(' + i + ')">' +
                '<span class="sp-ri-type">' + SMTool._esc(item.fieldType) + ' · ' + SMTool._esc(nodeLabel) + '</span>' +
                '<span class="sp-ri-text">' +
                    SMTool._esc(preview.substring(0, matchInPreview)) +
                    '<span class="sp-ri-match">' + SMTool._esc(preview.substring(matchInPreview, matchInPreview + item.matchLen)) + '</span>' +
                    SMTool._esc(preview.substring(matchInPreview + item.matchLen)) +
                '</span>' +
            '</div>';
        }
        listEl.innerHTML = html;
    };

    // 导航搜索结果
    SMTool._searchNav = function (dir) {
        if (SMData._searchResults.length === 0) return;
        var newIdx = SMData._searchActiveIdx + dir;
        if (newIdx < 0) newIdx = SMData._searchResults.length - 1;
        if (newIdx >= SMData._searchResults.length) newIdx = 0;
        SMTool._searchFocusResult(newIdx);
    };

    // 聚焦到某个搜索结果（带动画过渡）
    SMTool._searchFocusResult = function (index) {
        if (index < 0 || index >= SMData._searchResults.length) return;
        SMData._searchActiveIdx = index;
        var result2 = SMData._searchResults[index];
        var node3 = SMData.nodes.get(result2.nodeId);
        if (!node3) return;

        SMTool._updateSearchResults();

        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(result2.nodeId);
        SMData.selectedNode = result2.nodeId;
        SMData.selectedConnection = null;
        SMTool._updateSel();

        // ★ 高亮已在上层统一处理，此处不再重复清/加
        SMTool._animateToNode(node3);
    };

    // 动画过渡到目标节点（视口居中 + 缩放 40%）
    SMTool._animateToNode = function (node) {
        if (SMData._searchAnimId) {
            cancelAnimationFrame(SMData._searchAnimId);
            SMData._searchAnimId = 0;
        }

        var targetZoom = 0.3;
        var targetX = -(node.x + (node.width || 300) / 2);
        var targetY = -(node.y + ((node._canvasHeight || 200) + 100) / 2);

        var startZoom = SMData.view.zoom;
        var startX = SMData.view.x;
        var startY = SMData.view.y;
        var duration = 400;
        var startTime = performance.now();

        function easeInOutCubic(t) {
            return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        }

        function step(now) {
            var elapsed = now - startTime;
            var progress = Math.min(1, elapsed / duration);
            var t = easeInOutCubic(progress);

            SMData.view.zoom = startZoom + (targetZoom - startZoom) * t;
            SMData.view.x = startX + (targetX - startX) * t;
            SMData.view.y = startY + (targetY - startY) * t;
            SMData._forceRedraw = true;

            SMTool._updateAllPos(true);
            SMTool._syncZoomUI();

            if (progress < 1) {
                SMData._searchAnimId = requestAnimationFrame(step);
            } else {
                SMData._searchAnimId = 0;
            }
        }
        SMData._searchAnimId = requestAnimationFrame(step);
    };

    // 搜索框键盘事件
    var searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                SMTool._doSearch();
            }
            if (e.key === 'Escape') {
                SMTool._clearSearch();
                searchInput.value = '';
                searchInput.blur();
            }
        });
        var _searchDebounce = 0;
        searchInput.addEventListener('input', function () {
            clearTimeout(_searchDebounce);
            var val = searchInput.value.trim();
            if (!val) {
                SMTool._clearSearch();
                return;
            }
            _searchDebounce = setTimeout(function () {
                SMTool._doSearch();
            }, 200);
        });
    }

    // ================================================================
    // ★ 入口节点导航
    // ================================================================
    SMData._entryActiveIdx = -1;  // 当前高亮的入口列表子项索引
    SMData._entryNodeIds = [];    // 排序后的入口节点 ID 列表

    SMTool._toggleEntryNav = function () {
        var list = document.getElementById('entryNavList');
        var btn = document.getElementById('entryNavBtn');
        if (!list || !btn) return;
        var isOpen = (list.style.display !== 'none');
        if (isOpen) {
            SMTool._closeEntryNav();
        } else {
            SMTool._buildEntryNavList();
            list.style.display = 'block';
            btn.classList.add('active');
            var sr = document.getElementById('searchResults');
            if (sr) sr.style.display = 'none';
        }
    };

    SMTool._buildEntryNavList = function () {
        var list = document.getElementById('entryNavList');
        if (!list) return;
        var entries = [];
        var nodesIterE = SMData.nodes.values();
        var rE = nodesIterE.next();
        while (!rE.done) {
            if (rE.value.nodeType === 'entry') entries.push(rE.value);
            rE = nodesIterE.next();
        }
        if (entries.length === 0) {
            list.innerHTML = '<div class="sp-no-results">无入口节点</div>';
            SMData._entryNodeIds = [];
            return;
        }
        // ★ Y 轴优先：越靠上越靠前；Y 相同则 X 越靠左越靠前
        entries.sort(function (a, b) {
            var dY = a.y - b.y;
            if (Math.abs(dY) < 0.5) return a.x - b.x;
            return dY;
        });
        SMData._entryNodeIds = [];
        for (var ei = 0; ei < entries.length; ei++) {
            SMData._entryNodeIds.push(entries[ei].id);
        }
        // 恢复上次选中或默认第一个
        if (SMData._entryActiveIdx < 0 || SMData._entryActiveIdx >= entries.length) {
            SMData._entryActiveIdx = 0;
        }
        var html = '';
        // ★ 顶部导航栏
        html += '<div class="sp-entry-nav-bar">' +
            '<button class="sp-nav-btn" onclick="event.stopPropagation();SMTool._entryNavBy(-1)" title="上一个">◀</button>' +
            '<span class="sp-entry-nav-info">' + (SMData._entryActiveIdx + 1) + ' / ' + entries.length + '</span>' +
            '<button class="sp-nav-btn" onclick="event.stopPropagation();SMTool._entryNavBy(1)" title="下一个">▶</button>' +
            '</div>';
        // ★ 子项列表
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var title = entry.name || '入口';
            var activeClass = (i === SMData._entryActiveIdx) ? ' active' : '';
            html += '<div class="sp-entry-item' + activeClass + '" onclick="SMTool._goToEntryNode(' + entry.id + ')">' +
                '<span class="sp-entry-idx">' + (i + 1) + '</span>' +
                '<span class="sp-entry-title">' + SMTool._esc(title) + '</span>' +
            '</div>';
        }
        // ★ 底部收起按钮
        html += '<div class="sp-entry-close" onclick="event.stopPropagation();SMTool._closeEntryNav()">' +
            '<span>▲ 收起列表</span></div>';
        list.innerHTML = html;
        // ★ 键盘导航
        SMTool._bindEntryNavKeys(list);
    };

    // 绑定入口列表键盘事件
    SMTool._bindEntryNavKeys = function (list) {
        if (list._keyBound) return;
        list._keyBound = true;
        list.setAttribute('tabindex', '0');
        list.addEventListener('keydown', function (e) {
            var ids = SMData._entryNodeIds;
            if (!ids || ids.length === 0) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                SMTool._entryNavBy(-1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                SMTool._entryNavBy(1);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (SMData._entryActiveIdx >= 0 && SMData._entryActiveIdx < ids.length) {
                    SMTool._goToEntryNode(ids[SMData._entryActiveIdx]);
                }
            } else if (e.key === 'Escape') {
                SMTool._closeEntryNav();
            }
        });
        // 展开时自动聚焦
        setTimeout(function () { list.focus(); }, 50);
    };

    // 入口列表导航（dir: -1 上一个, 1 下一个）
    SMTool._entryNavBy = function (dir) {
        var ids = SMData._entryNodeIds;
        if (!ids || ids.length === 0) return;
        var newIdx = SMData._entryActiveIdx + dir;
        if (newIdx < 0) newIdx = ids.length - 1;
        if (newIdx >= ids.length) newIdx = 0;
        SMData._entryActiveIdx = newIdx;
        // 刷新列表高亮
        var list = document.getElementById('entryNavList');
        if (list) {
            var items = list.querySelectorAll('.sp-entry-item');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.toggle('active', i === newIdx);
            }
            var info = list.querySelector('.sp-entry-nav-info');
            if (info) info.textContent = (newIdx + 1) + ' / ' + ids.length;
        }
        // 跳转到对应入口节点
        SMTool._goToEntryNode(ids[newIdx]);
    };

    SMTool._goToEntryNode = function (nodeId) {
        var node2 = SMData.nodes.get(nodeId);
        if (!node2) return;
        // ★ 更新选中索引
        for (var i = 0; i < SMData._entryNodeIds.length; i++) {
            if (SMData._entryNodeIds[i] === nodeId) {
                SMData._entryActiveIdx = i;
                break;
            }
        }
        // 刷新列表高亮
        var list = document.getElementById('entryNavList');
        if (list && list.style.display !== 'none') {
            var items = list.querySelectorAll('.sp-entry-item');
            for (var j = 0; j < items.length; j++) {
                items[j].classList.toggle('active', j === SMData._entryActiveIdx);
            }
            var info2 = list.querySelector('.sp-entry-nav-info');
            if (info2) info2.textContent = (SMData._entryActiveIdx + 1) + ' / ' + SMData._entryNodeIds.length;
        }
        // ★ 不再自动关闭列表，保持展开便于连续切换
        SMData.selectedNodes.clear();
        SMData.selectedNodes.add(nodeId);
        SMData.selectedNode = nodeId;
        SMTool._updateSel();
        SMTool._animateToNode(node2);
    };

    // 收起入口导航列表
    SMTool._closeEntryNav = function () {
        var list = document.getElementById('entryNavList');
        var btn = document.getElementById('entryNavBtn');
        if (list) {
            list.style.display = 'none';
            list._keyBound = false;
        }
        if (btn) btn.classList.remove('active');
        SMData._entryActiveIdx = -1;
    };

    // ================================================================
    // ★ 显示/隐藏切换按钮（左上角）
    // 逻辑：可见（默认）= 高亮，隐藏 = 置灰
    // ================================================================
    SMTool._toggleHideLabels = function () {
        SMData._hideLabels = !SMData._hideLabels;
        var app = document.getElementById('app');
        var btn = document.getElementById('btnToggleLabels');
        if (SMData._hideLabels) {
            app.classList.add('hide-labels');
            btn.classList.remove('active');
            btn.textContent = '📝 标题';
        } else {
            app.classList.remove('hide-labels');
            btn.classList.add('active');
            btn.textContent = '📝 标题';
        }
    };
    SMTool._toggleHideBubbles = function () {
        SMData._hideBubbles = !SMData._hideBubbles;
        var app = document.getElementById('app');
        var btn = document.getElementById('btnToggleBubbles');
        if (SMData._hideBubbles) {
            app.classList.add('hide-bubbles');
            btn.classList.remove('active');
            btn.textContent = '💬 特效';
        } else {
            app.classList.remove('hide-bubbles');
            btn.classList.add('active');
            btn.textContent = '💬 特效';
        }
    };
    SMTool._toggleHideBoneImgs = function () {
        SMData._hideBoneImgs = !SMData._hideBoneImgs;
        var btn = document.getElementById('btnToggleBoneImgs');
        if (SMData._hideBoneImgs) {
            btn.classList.remove('active');
            btn.textContent = '🖼️ 挂点';
        } else {
            btn.classList.add('active');
            btn.textContent = '🖼️ 挂点';
        }
    };
    SMTool._toggleHideIndicators = function () {
        SMData._hideIndicators = !SMData._hideIndicators;
        var app = document.getElementById('app');
        var btn = document.getElementById('btnToggleIndicators');
        if (SMData._hideIndicators) {
            app.classList.add('hide-indicators');
            btn.classList.remove('active');
            btn.textContent = '🏷️ 标记';
        } else {
            app.classList.remove('hide-indicators');
            btn.classList.add('active');
            btn.textContent = '🏷️ 标记';
        }
    };

    // 🔒 [LOCK-5] 第二道防线：200ms 定期巡检，仅修复 timeScale=0 残留冻结
    // 跳过条件：面板展开且有选中节点（正常流模式）、流正在播放
    // 巡检条件：鼠标在面板外 或 面板已收起
    // 规则：只解冻 timeScale，不做 _applyTracksToState（避免重置正常动画）
    setInterval(function () {
        if (SMData._flowPanel.expanded && SMData.selectedNode) return;
        if (SMData._fullPlayback.isPlaying) return;
        var panel = document.getElementById('flowPanel');
        var inPanel = false;
        if (panel && SMData._mx !== undefined && SMData._my !== undefined) {
            var rect = panel.getBoundingClientRect();
            inPanel = (SMData._mx >= rect.left && SMData._mx <= rect.right &&
                       SMData._my >= rect.top && SMData._my <= rect.bottom);
        }
        if (!inPanel || !SMData._flowPanel.expanded) {
            var nodesIter = SMData.nodes.values();
            var nr = nodesIter.next();
            while (!nr.done) {
                var n = nr.value;
                if (n.state && n.skeletonData) {
                    try {
                        for (var ti = 0; ti < 5; ti++) {
                            var entry = n.state.getCurrent(ti);
                            if (entry && entry.timeScale === 0) {
                                entry.timeScale = 1.0;
                            }
                        }
                    } catch (e) {}
                }
                nr = nodesIter.next();
            }
        }
    }, 200);
};

// ================================================================
//  对齐排版功能（多选 ≥2 个节点时可用）
// ================================================================

// 获取节点在世界空间中的矩形（基于 DOM 实际渲染尺寸）
SMTool._getNodeWorldRect = function (node) {
    var el = SMTool._getEl(node.id);
    if (el) {
        var rect = el.getBoundingClientRect();
        var tl = SMTool.canvasToWorld(rect.left, rect.top);
        var br = SMTool.canvasToWorld(rect.right, rect.bottom);
        return {
            left: node.x, top: node.y,
            right: node.x + (br.x - tl.x),
            bottom: node.y + (br.y - tl.y),
            width: br.x - tl.x,
            height: br.y - tl.y,
            cx: node.x + (br.x - tl.x) / 2,
            cy: node.y + (br.y - tl.y) / 2
        };
    }
    var h = (node._canvasHeight || 200) + 150;
    var w = node.width || 300;
    return {
        left: node.x, top: node.y,
        right: node.x + w, bottom: node.y + h,
        width: w, height: h,
        cx: node.x + w / 2, cy: node.y + h / 2
    };
};

// 获取所有选中节点的世界矩形数组（组内节点合并为组包围盒，作为整体计算）
SMTool._getSelectedRects = function () {
    var rects = [];
    var accounted = new Set();

    var selArray = [];
    SMData.selectedNodes.forEach(function (nid) { selArray.push(nid); });
    for (var si = 0; si < selArray.length; si++) {
        var nid = selArray[si];
        if (accounted.has(nid)) continue;
        var n = SMData.nodes.get(nid);
        if (!n) continue;
        var grp = SMTool._findGroupOf(nid);
        if (grp) {
            var bb = SMTool._getGroupBounds(grp);
            if (!bb) continue;
            var groupNodes = [];
            grp.nodeIds.forEach(function (gid) {
                accounted.add(gid);
                var gn = SMData.nodes.get(gid);
                if (gn) groupNodes.push(gn);
            });
            rects.push({
                nodes: groupNodes,
                rect: {
                    left: bb.left, top: bb.top, right: bb.right, bottom: bb.bottom,
                    width: bb.right - bb.left, height: bb.bottom - bb.top,
                    cx: (bb.left + bb.right) / 2, cy: (bb.top + bb.bottom) / 2
                }
            });
        } else {
            accounted.add(nid);
            rects.push({
                nodes: [n],
                rect: SMTool._getNodeWorldRect(n)
            });
        }
    }
    return rects;
};

// 计算选中节点的包围盒
SMTool._getSelBounds = function (items) {
    var minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (var i = 0; i < items.length; i++) {
        var r = items[i].rect;
        if (r.left < minL) minL = r.left;
        if (r.top < minT) minT = r.top;
        if (r.right > maxR) maxR = r.right;
        if (r.bottom > maxB) maxB = r.bottom;
    }
    return { left: minL, top: minT, right: maxR, bottom: maxB, width: maxR - minL, height: maxB - minT, cx: (minL + maxR) / 2, cy: (minT + maxB) / 2 };
};

// ---- 横向对齐 ----

SMTool.alignTop = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dy = bb.top - items[i].rect.top;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].y += dy;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.alignMidH = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dy = bb.cy - items[i].rect.cy;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].y += dy;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.alignBottom = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dy = bb.bottom - items[i].rect.bottom;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].y += dy;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

// ---- 竖向对齐 ----

SMTool.alignLeft = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dx = bb.left - items[i].rect.left;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].x += dx;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.alignMidV = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dx = bb.cx - items[i].rect.cx;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].x += dx;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.alignRight = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);
    for (var i = 0; i < items.length; i++) {
        var dx = bb.right - items[i].rect.right;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].x += dx;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

// ---- 平均分布 ----

SMTool.distributeH = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 3) return;
    SMTool.pushUndo();
    items.sort(function (a, b) { return a.rect.left - b.rect.left; });
    var leftmost = items[0].rect.left;
    var rightmost = items[items.length - 1].rect.right;
    var totalW = 0;
    for (var i = 0; i < items.length; i++) totalW += items[i].rect.width;
    var gap = (rightmost - leftmost - totalW) / (items.length - 1);
    var curX = items[0].rect.left;
    for (var i = 1; i < items.length - 1; i++) {
        curX += items[i - 1].rect.width + gap;
        var dx = curX - items[i].rect.left;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].x += dx;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.distributeV = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 3) return;
    SMTool.pushUndo();
    items.sort(function (a, b) { return a.rect.top - b.rect.top; });
    var topmost = items[0].rect.top;
    var bottommost = items[items.length - 1].rect.bottom;
    var totalH = 0;
    for (var i = 0; i < items.length; i++) totalH += items[i].rect.height;
    var gap = (bottommost - topmost - totalH) / (items.length - 1);
    var curY = items[0].rect.top;
    for (var i = 1; i < items.length - 1; i++) {
        curY += items[i - 1].rect.height + gap;
        var dy = curY - items[i].rect.top;
        for (var j = 0; j < items[i].nodes.length; j++) {
            items[i].nodes[j].y += dy;
            SMTool._updatePos(items[i].nodes[j]);
        }
    }
    SMTool._updateSel();
};

SMTool.toggleSnap = function () {
    SMData._snapEnabled = !SMData._snapEnabled;
    var btn = document.getElementById('btnSnap');
    if (btn) btn.classList.toggle('active', SMData._snapEnabled);
};

// ---- 右键菜单：添加标题 ----
SMTool.ctxAddTitle = function () {
    document.getElementById('ctxMenu').style.display = 'none';
    SMTool.pushUndo();
    var id = SMData.nextId++;
    var node = new SpineNodeData(id);
    node.nodeType = 'titleText';
    node.name = '标题';
    node._textContent = '标题';
    node._lineBreakPositions = [];  // ★ 初始化换行位置数组
    node._loopMode = null;
    node._loopCount = 1;
    node._loopTime = null;
    var wp = SMTool.canvasToWorld(SMData._mx || window.innerWidth / 2, SMData._my || window.innerHeight / 2);
    node.x = wp.x;
    node.y = wp.y;
    node.width = 200;
    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);
    SMData.selectedNodes.clear();
    SMData.selectedNodes.add(id);
    SMData.selectedNode = id;
    SMTool._updateSel();
    SMTool._updateSB();
};

// ★ 更新标题节点文本
// 换行字符（Enter键）会被存储为 \n，JSON 序列化后保留，下次打开工程时还原换行位置
SMTool._updateTitleText = function (nid, text) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    // 规范化换行：Windows 的 \r\n → \n，确保跨平台一致
    var normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    node._textContent = normalized;
    node.name = normalized;
    // ★ 同时存储换行位置（字符索引数组），用于精确还原
    var positions = [];
    for (var i = 0; i < normalized.length; i++) {
        if (normalized.charAt(i) === '\n') positions.push(i);
    }
    node._lineBreakPositions = positions;
};

// ★ 播放倍速：滑块拖动（实时更新）
// sliderVal: 0~1000，映射到 -5.00 ~ +5.00
SMTool._onSpeedSlider = function (nid, sliderVal) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var speed = Math.round((parseInt(sliderVal) / 100 - 5) * 100) / 100;
    if (speed < -5) speed = -5;
    if (speed > 5) speed = 5;
    node._playbackSpeed = speed;
    // 同步更新数字输入框
    var input = document.getElementById('speedInput-' + nid);
    if (input) input.value = speed.toFixed(2);
    // ★ 同步刷新浮窗预览
    SMTool._syncPreviewSpeed(nid, speed);
};

// ★ 播放倍速：数字输入框变更
SMTool._onSpeedInput = function (nid, val) {
    var node = SMData.nodes.get(nid);
    if (!node) return;
    var speed = parseFloat(val);
    if (isNaN(speed)) speed = 1.0;
    if (speed < -5) speed = -5;
    if (speed > 5) speed = 5;
    speed = Math.round(speed * 100) / 100;
    node._playbackSpeed = speed;
    // 同步更新滑块
    var input = document.getElementById('speedInput-' + nid);
    if (input) input.value = speed.toFixed(2);
    var el = SMTool._getEl(nid);
    if (el) {
        var slider = el.querySelector('.speed-slider');
        if (slider) slider.value = Math.round((speed + 5) * 100);
    }
    // ★ 同步刷新浮窗预览
    SMTool._syncPreviewSpeed(nid, speed);
};

// ★ 同步倍速到预览浮窗（单节点预览 & 层级预览均需即时生效）
SMTool._syncPreviewSpeed = function (nid, speed) {
    var pp = SMData._animPreview;
    if (!pp || !pp.visible) return;
    // 单节点预览：源节点匹配时，预览的 TrackEntry timeScale 即时更新
    if (pp.nodeId === nid && pp.state && !pp._layerSkeletons) {
        try {
            var te = pp.state.getCurrent(0);
            if (te) te.timeScale = speed;
        } catch (e) {}
    }
    // 层级预览：遍历所有层的所有链骨架，匹配源节点并更新 timeScale
    if (pp._layerSkeletons) {
        for (var li = 0; li < pp._layerSkeletons.length; li++) {
            var ls = pp._layerSkeletons[li];
            var skeletons = ls._chainSkeletons || [ls];
            for (var si = 0; si < skeletons.length; si++) {
                var sk = skeletons[si];
                if (sk._chainNodeId === nid && sk.state) {
                    try {
                        var te2 = sk.state.getCurrent(0);
                        if (te2) te2.timeScale = speed;
                    } catch (e) {}
                }
            }
        }
    }
};

// ★ 数据浮窗面板倍速滑块（应用于所有选中节点）
SMTool._onPanelSpeedSlider = function (sliderVal) {
    var speed = Math.round((parseInt(sliderVal) / 100 - 5) * 100) / 100;
    if (speed < -5) speed = -5;
    if (speed > 5) speed = 5;
    // 更新数字框
    var input = document.getElementById('dfpSpeedInput');
    if (input) input.value = speed.toFixed(2);
    // 应用到所有选中的 spine 节点
    SMTool._applySpeedToSelected(speed);
};

// ★ 数据浮窗面板倍速输入框
SMTool._onPanelSpeedInput = function (val) {
    var speed = parseFloat(val);
    if (isNaN(speed)) speed = 1.0;
    if (speed < -5) speed = -5;
    if (speed > 5) speed = 5;
    speed = Math.round(speed * 100) / 100;
    var input = document.getElementById('dfpSpeedInput');
    if (input) input.value = speed.toFixed(2);
    // 更新滑块
    var footer = document.getElementById('dfpFooter');
    if (footer) {
        var slider = footer.querySelector('.dfp-speed-slider');
        if (slider) slider.value = Math.round((speed + 5) * 100);
    }
    // 应用到所有选中的 spine 节点
    SMTool._applySpeedToSelected(speed);
};

// ★ 将倍速应用到所有选中节点并同步 UI
SMTool._applySpeedToSelected = function (speed) {
    SMData.selectedNodes.forEach(function (nid) {
        var n = SMData.nodes.get(nid);
        if (!n || n.nodeType !== 'spine') return;
        n._playbackSpeed = speed;
        // 更新该节点面板上的倍速 UI
        var input = document.getElementById('speedInput-' + nid);
        if (input) input.value = speed.toFixed(2);
        var el = SMTool._getEl(nid);
        if (el) {
            var slider = el.querySelector('.speed-slider');
            if (slider) slider.value = Math.round((speed + 5) * 100);
        }
        // 同步浮窗预览
        SMTool._syncPreviewSpeed(nid, speed);
    });
};

// ★ 右键菜单：插入图片（已禁用——请使用数据面板的"📁 选取图片"添加截图）
SMTool.ctxInsertImage = function () {
    document.getElementById('ctxMenu').style.display = 'none';
    document.getElementById('sbStatus').textContent = '⚠️ 请使用数据面板中的"📁 选取图片"为骨骼/皮肤/插槽添加截图';
    setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 3000);
};

// ★ 更新入口节点名称
SMTool._updateEntryName = function (nid, text) {
    var node = SMData.nodes.get(nid);
    if (node) node.name = text;
};

// ---- 按指定间距分布 ----
SMTool._gapStep = function (dir) {
    var input = document.getElementById('gapInput');
    if (!input) return;
    var v = parseFloat(input.value) || 0;
    v = Math.max(0, v + dir * 5);
    input.value = v;
};

SMTool.applyGapDistribute = function () {
    var items = SMTool._getSelectedRects();
    if (items.length < 2) return;
    var input = document.getElementById('gapInput');
    var gapVal = input ? parseFloat(input.value) : 0;
    if (isNaN(gapVal) || gapVal < 0) return;
    var gap = gapVal / Math.max(0.03, SMData.view.zoom);

    SMTool.pushUndo();
    var bb = SMTool._getSelBounds(items);

    if (bb.width >= bb.height) {
        items.sort(function (a, b) { return a.rect.left - b.rect.left; });
        var curX = items[0].rect.left;
        for (var i = 1; i < items.length; i++) {
            curX += items[i - 1].rect.width + gap;
            var dx = curX - items[i].rect.left;
            for (var j = 0; j < items[i].nodes.length; j++) {
                items[i].nodes[j].x += dx;
                SMTool._updatePos(items[i].nodes[j]);
            }
        }
    } else {
        items.sort(function (a, b) { return a.rect.top - b.rect.top; });
        var curY = items[0].rect.top;
        for (var i = 1; i < items.length; i++) {
            curY += items[i - 1].rect.height + gap;
            var dy = curY - items[i].rect.top;
            for (var j = 0; j < items[i].nodes.length; j++) {
                items[i].nodes[j].y += dy;
                SMTool._updatePos(items[i].nodes[j]);
            }
        }
    }
    SMTool._updateSel();
};

// ---- 自动启动 ----
function _doInit() {
    SMTool.init();
}

window.addEventListener('DOMContentLoaded', function () {
    if (window.spine && window.spine.webgl && window.spine.webgl.SkeletonRenderer) {
        _doInit();
    } else {
        window._onSpineReady = _doInit;
        setTimeout(function () {
            if (!window.spine || !window.spine.webgl) {
                console.warn('[Init] Spine runtime timeout');
                _doInit();
            }
        }, 10000);
    }
});
