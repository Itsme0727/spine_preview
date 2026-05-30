/* ================================================================
   应用主入口 — SMTool 公共 API & 初始化
   挂载到全局 SMTool 对象，汇总所有模块功能
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 公共方法 ----

// 添加空节点
SMTool.addSpineNode = function () {
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
    // 删除相关连线
    SMData.connections = SMData.connections.filter(function (c) {
        return c.fromNode !== nid && c.toNode !== nid;
    });

    // 清理 WebGL 资源
    var node = SMData.nodes.get(nid);
    if (node) {
        if (node.state) node.state.clearTracks();
        if (node.glTextures) {
            node.glTextures.forEach(function (t) {
                try { t.dispose(); } catch (e) {}
            });
        }
        if (node.batcher) { try { node.batcher.dispose(); } catch (e) {} }
        if (node.shader) { try { node.shader.dispose(); } catch (e) {} }
        if (node.sceneRenderer) { try { node.sceneRenderer.dispose(); } catch (e) {} }
    }

    var el = SMTool._getEl(nid);
    if (el) el.remove();
    SMData.nodes.delete(nid);
    SMData.selectedNodes.delete(nid);
    if (SMData.selectedNode === nid) SMData.selectedNode = null;

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
    node._srcType = orig._srcType;
    node.currentAnim = orig.currentAnim;
    node.animations = orig.animations.slice();
    node.skins = orig.skins.slice();
    node.slots = orig.slots.slice();
    node.bones = orig.bones.slice();
    node.version = orig.version;

    SMData.nodes.set(id, node);
    SMTool._createEl(node);
    SMTool._updatePos(node);

    if (node._srcAtlasText && node._srcTexDataUrl &&
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
    var ed = document.getElementById('conditionEditor');
    for (var i = 0; i < SMData.connections.length; i++) {
        if (SMData.connections[i].id === ed._cid) {
            SMData.connections[i].condition = document.getElementById('condInput').value.trim();
            break;
        }
    }
    ed.classList.remove('show');
};

// 删除连线
SMTool.deleteConnection = function () {
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

    SMTool.resize();
    window.addEventListener('resize', function () { SMTool.resize(); });

    // 鼠标事件
    document.addEventListener('mousedown', function (e) {
        if (e.target.closest('#toolbar, #ctxMenu, #conditionEditor, #zoomControl, #statusBar')) return;
        if (e.target.closest('input, textarea, select, button')) return;
        SMTool._onMD(e);
    });
    window.addEventListener('mousemove', function (e) { SMTool._onMM(e); });
    window.addEventListener('mouseup', function (e) { SMTool._onMU(e); });

    // 滚轮缩放
    window.addEventListener('wheel', function (e) {
        if (!e.target.closest('.state-list') && !e.target.closest('.anim-bar') && !e.target.closest('.anim-select') && !e.target.closest('.ip-body') && !e.target.closest('#conditionEditor')) {
            e.preventDefault();
            SMTool._onWheel(e);
        }
    }, { passive: false });

    // 右键菜单
    SMTool.gridCanvas.addEventListener('contextmenu', function (e) {
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

    // 键盘
    window.addEventListener('keydown', function (e) { SMTool._onKD(e); });

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

    // 启动渲染循环
    SMTool._lt = performance.now();
    SMTool._fc = 0;
    SMTool._ft = performance.now();
    requestAnimationFrame(function (t) { SMTool._loop(t); });

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
