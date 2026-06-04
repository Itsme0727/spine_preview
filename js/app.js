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
        if (node.batcher) { try { node.batcher.dispose(); } catch (e) {} }
        if (node.shader) { try { node.shader.dispose(); } catch (e) {} }
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
    node._boneShotRefs = orig._boneShotRefs ? JSON.parse(JSON.stringify(orig._boneShotRefs)) : {};
    node._stateDesc = orig._stateDesc || '';
    node._textContent = orig._textContent || '';
    node._exitText = orig._exitText || '';
    node.loop = orig.loop;
    // 深拷贝轨道配置
    node.tracks = orig.tracks ? JSON.parse(JSON.stringify(orig.tracks)) : [];

    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);

    if (node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
        (node._srcSkelJson || node._srcSkelBinBase64)) {
        SMTool._loadFromSourceData(node).then(function () {
            SMTool._updateEl(node);
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
SMTool._setSkin = function (nid, skinName) {
    var clickedNode = SMData.nodes.get(nid);
    if (!clickedNode || !clickedNode.skeleton || !clickedNode.skeletonData) return;

    var sourceFile = clickedNode.sourceFile;

    // 遍历所有节点，找到同归属文件的节点一起切换皮肤
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var node = result.value;
        if (node.sourceFile === sourceFile && node.skeleton && node.skeletonData) {
            // 从 skeletonData 中找到对应皮肤对象
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
        result = nodesIter.next();
    }

    // 同步刷新数据面板高亮
    SMTool._updateFloatPanel();
};

// 切换连线模式
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
    window.addEventListener('resize', function () { SMTool.resize(); });

    // 鼠标事件（数据面板内的操作不取消动画对象选中）
    document.addEventListener('mousedown', function (e) {
        if (e.target.closest && e.target.closest('#toolbar, #ctxMenu, #conditionEditor, #zoomControl, #statusBar, #dataFloatPanel, #flowPanel, #flowModeToggle')) return;
        if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
        if (e.shiftKey) e.preventDefault();
        SMTool._onMD(e);
    });
    window.addEventListener('mousemove', function (e) { SMTool._onMM(e); });
    window.addEventListener('mouseup', function (e) { SMTool._onMU(e); });

    // 滚轮缩放（面板内滚动内容，不缩放画布）
    window.addEventListener('wheel', function (e) {
        if (!e.target.closest('.state-list') && !e.target.closest('.anim-bar') && !e.target.closest('.anim-select') && !e.target.closest('.ip-body') && !e.target.closest('#conditionEditor') && !e.target.closest('#dataFloatPanel')) {
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
        if (!SMData.selectedNode) return;
        var node = SMData.nodes.get(SMData.selectedNode);
        if (!node || node.nodeType !== 'spine') return;

        // 目标骨骼：严格使用 _pasteTargetBone（点击骨骼行/+时设置）
        var targetBoneName = SMData._pasteTargetBone;
        if (!targetBoneName || !node._boneTags || !node._boneTags[targetBoneName]) {
            // 兜底：取第一个已标记的骨骼
            if (node._boneTags) {
                var keys = Object.keys(node._boneTags);
                if (keys.length > 0) targetBoneName = keys[0];
            }
        }
        if (!targetBoneName) {
            document.getElementById('sbStatus').textContent = '请先在面板中点击骨骼旁的 + 标记锚点';
            setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2500);
            return;
        }

        var loaded = 0;
        var dataUrls = [];
        for (var j = 0; j < imageBlobs.length; j++) {
            (function (blob) {
                var reader = new FileReader();
                reader.onload = function () {
                    dataUrls.push(reader.result);
                    loaded++;
                    if (loaded === imageBlobs.length) {
                        SMTool._addBoneScreenshots(targetBoneName, dataUrls);
                        document.getElementById('sbStatus').textContent = '✅ 已粘贴 ' + loaded + ' 张截图 → ' + targetBoneName;
                        setTimeout(function () { document.getElementById('sbStatus').textContent = ''; }, 2000);
                    }
                };
                reader.onerror = function () { loaded++; };
                reader.readAsDataURL(blob);
            })(imageBlobs[j]);
        }
    });

    // 全局点击关闭右键菜单
    window.addEventListener('click', function () {
        document.getElementById('ctxMenu').style.display = 'none';
    });

    // 双击重置控制点
    window.addEventListener('dblclick', function (e) {
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
        document.getElementById('flowModeThree').classList.toggle('active', mode === 'three');
        document.getElementById('flowModeFull').classList.toggle('active', mode === 'full');
        // 清除焦点和播放状态
        SMData._flowFocus = null;
        SMData._fullPlayback.activePathIdx = -1;
        SMData._fullPlayback.currentStep = 0;
        SMData._fullPlayback.isPlaying = false;
        if (SMData._fullPlayback._timer) { clearTimeout(SMData._fullPlayback._timer); SMData._fullPlayback._timer = null; }
        SMTool._clearAllProgressBars();
        SMTool._resumeAllNodes();
        // 清除全画布缓存（含 WebGL 资源释放）
        SMTool._disposeFullCanvasResources();
        SMTool._updateFlowPanel();
        if (mode === 'full' && SMData.selectedNode) {
            SMTool._setFullComponentFocus(SMData.selectedNode);
        }
        SMTool._updateSel();
        SMTool._updateStateRowColors();
    };

    // ---- 完整动画组路径穷举（DFS 从源节点到所有终点） ----
    SMTool._findAllFullPaths = function (sourceId) {
        var paths = [];

        function dfs(currentId, nodePath, connPath, pathVisited) {
            // 找所有出边
            var outConns = [];
            for (var i = 0; i < SMData.connections.length; i++) {
                var c = SMData.connections[i];
                if (c.fromNode === currentId) outConns.push(c);
            }

            if (outConns.length === 0) {
                // 终点节点：记录路径（至少包含源节点）
                if (nodePath.length >= 1) {
                    paths.push({ nodes: nodePath.slice(), conns: connPath.slice() });
                }
                return;
            }

            for (var j = 0; j < outConns.length; j++) {
                var oc = outConns[j];
                var nextId = oc.toNode;
                // 防止环路
                if (pathVisited.has(nextId)) {
                    // 遇到环路，记录当前路径（含闭环连线+闭环节点）
                    if (nodePath.length >= 1) {
                        var cycleConnPath = connPath.slice();
                        cycleConnPath.push(oc.id);
                        var cycleNodes = nodePath.slice();
                        // 闭环终点节点（虚线框表示），取源节点的动画名
                        var closeNode = SMData.nodes.get(nextId);
                        if (closeNode) {
                            var closeAnim = oc.toState || closeNode.currentAnim || (closeNode.animations.length > 0 ? closeNode.animations[0].name : closeNode.name);
                            cycleNodes.push({ id: nextId, anim: closeAnim, cycleClose: true });
                        }
                        paths.push({ nodes: cycleNodes, conns: cycleConnPath });
                    }
                    continue;
                }
                var nextNode = SMData.nodes.get(nextId);
                if (!nextNode) continue;
                var animName = oc.toState || nextNode.currentAnim || (nextNode.animations.length > 0 ? nextNode.animations[0].name : nextNode.name);

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
        var srcAnim = srcNode.currentAnim || (srcNode.animations.length > 0 ? srcNode.animations[0].name : srcNode.name);

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
        var g = {
            id: SMData.nextGroupId++,
            nodeIds: new Set(ids),
            color: SMTool._groupColors[(SMData.nextGroupId - 1) % SMTool._groupColors.length]
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
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + (n._canvasHeight || 200) + 100);
        });
        return any ? { left: minX, top: minY, right: maxX, bottom: maxY } : null;
    };

    SMTool._findGroupOf = function (nodeId) {
        for (var i = 0; i < SMData.groups.length; i++) {
            if (SMData.groups[i].nodeIds.has(nodeId)) return SMData.groups[i];
        }
        return null;
    };

    SMTool._renderGroupBoxes = function (ctx) {
        for (var i = 0; i < SMData.groups.length; i++) {
            var g = SMData.groups[i];
            var bb = SMTool._getGroupBounds(g);
            if (!bb) continue;
            var tl = SMTool.worldToCanvas(bb.left, bb.top);
            var br = SMTool.worldToCanvas(bb.right, bb.bottom);
            ctx.save();
            ctx.strokeStyle = g.color;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.restore();
        }
    };

    // ---- 渲染模式切换 ----
    SMTool.setRenderMode = function (mode) {
        SMData.renderMode = mode;
        document.getElementById('modePerf').classList.toggle('active', mode === 'perf');
        document.getElementById('modeDyn').classList.toggle('active', mode === 'dyn');
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
        node.name = '入口';
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
                color: c.color || ''
            });
        }

        // 序列化节点
        var nodesIter = SMData.nodes.values();
        var result = nodesIter.next();
        // 源数据引用缓存（避免每份快照复制 base64 图片等大块数据）
        if (!SMData._srcCache) SMData._srcCache = {};
        while (!result.done) {
            var n = result.value;
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
                _srcKey: srcKey,   // 源数据引用 key，不再复制大块数据
                _boneTags: n._boneTags ? JSON.parse(JSON.stringify(n._boneTags)) : {},
                _boneNotes: n._boneNotes ? JSON.parse(JSON.stringify(n._boneNotes)) : {},
                // 快照中将 shotId 转回 dataUrl，确保 undo/redo 不依赖 _shotStore 生命周期
                _boneScreenshots: n._boneScreenshots ? SMTool._serializeShots(n._boneScreenshots) : {},
                _boneShotRefs: n._boneShotRefs ? JSON.parse(JSON.stringify(n._boneShotRefs)) : {},
                _stateDesc: n._stateDesc || '',
                _exitText: n._exitText || '',
                _textContent: n._textContent || '',
                _customScale: n._customScale !== undefined ? n._customScale : 1.0,
                infoCollapsed: !!n.infoCollapsed
            });
            result = nodesIter.next();
        }

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
                color: grp.color
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
                if (delNode.batcher) { try { delNode.batcher.dispose(); } catch (e) {} }
                if (delNode.shader) { try { delNode.shader.dispose(); } catch (e) {} }
                if (delNode.sceneRenderer) { try { delNode.sceneRenderer.dispose(); } catch (e) {} }
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
                existing._stateDesc = nd._stateDesc || '';
                existing._exitText = nd._exitText || '';
                existing._textContent = nd._textContent || '';
                existing._customScale = nd._customScale !== undefined ? nd._customScale : 1.0;
                existing.infoCollapsed = !!nd.infoCollapsed;

                // 更新动画（即时切换，无需重载）
                if (existing.state && existing.currentAnim !== (nd.currentAnim || '')) {
                    try {
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
                node._stateDesc = nd._stateDesc || '';
                node._exitText = nd._exitText || '';
                node._textContent = nd._textContent || '';
                node._customScale = nd._customScale !== undefined ? nd._customScale : 1.0;
                node.infoCollapsed = !!nd.infoCollapsed;

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
                color: c.color || ''
            };
        });

        // ---- 5. 恢复分组 ----
        SMData.groups = (snap.groups || []).map(function (g) {
            return {
                id: g.id,
                nodeIds: new Set(g.nodeIds || []),
                color: g.color
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
        SMTool._updateAllPos();
        SMTool._updateSel();
        SMTool._updateSB();
        SMTool._updateStateRowColors();
        SMTool._updateDuplicateHighlights();
        SMTool._checkMissingStates();
        SMTool._refreshAllTranslations();
        SMTool._updateFlowPanel();
        SMTool._updateFloatPanel();

        // 同步模式按钮
        document.getElementById('modePerf').classList.toggle('active', SMData.renderMode === 'perf');
        document.getElementById('modeDyn').classList.toggle('active', SMData.renderMode === 'dyn');
        document.getElementById('flowModeThree').classList.toggle('active', SMData.flowMode === 'three');
        document.getElementById('flowModeFull').classList.toggle('active', SMData.flowMode === 'full');
    };

    // 压入撤销栈（在操作前调用）
    SMTool.pushUndo = function () {
        if (SMData._isUndoRedo) return; // 正在执行撤销/重做，不压栈
        var snap = SMTool._snapshotState();
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
        if (!SMTool._snapEqual(SMData._pendingDragSnap, endSnap)) {
            // 状态确实变了 → 压入拖拽前的快照
            SMData._undoStack.push(SMData._pendingDragSnap);
            while (SMData._undoStack.length > SMData._undoMaxSteps) {
                SMData._undoStack.shift();
            }
            SMData._redoStack = [];
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
        // 保存当前状态到重做栈
        var currentSnap = SMTool._snapshotState();
        SMData._redoStack.push(currentSnap);
        // 取出上一个快照恢复
        var prevSnap = SMData._undoStack.pop();
        SMTool._restoreState(prevSnap);
        SMData._isUndoRedo = false;
        document.getElementById('sbStatus').textContent = '已撤销 (' + SMData._undoStack.length + ' 步可撤销)';
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
    SMTool.setFlowMode('three');  // 初始模式为三层

    SMTool._updateSB();

    console.log('🎬 Spine Animation State Machine ready!');
    console.log('  拖拽 spine 文件三件套 (.json/.skel + .atlas + .png) 到画布上');
    console.log('  Alt+拖拽=平移 | 滚轮=缩放 | 右键=平移');
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
