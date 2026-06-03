/* ================================================================
   导出/导入 — JSON 项目文件序列化与反序列化
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 序列化当前项目数据为 JSON 字符串 ----
SMTool._serializeData = function () {
    var data = {
        nodes: [],
        connections: [],
        view: SMData.view
    };

    // 序列化连线
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        data.connections.push({
            id: c.id,
            fromNode: c.fromNode,
            fromState: c.fromState,
            toNode: c.toNode,
            toState: c.toState,
            condition: c.condition,
            cp1x: c.cp1x,
            cp1y: c.cp1y,
            cp2x: c.cp2x,
            cp2y: c.cp2y,
            color: c.color
        });
    }

    // 序列化节点
    var nodesIter = SMData.nodes.values();
    var result = nodesIter.next();
    while (!result.done) {
        var n = result.value;
        data.nodes.push({
            id: n.id,
            name: n.name,
            nodeType: n.nodeType,
            x: n.x,
            y: n.y,
            animations: n.animations,
            skins: n.skins,
            slots: n.slots,
            bones: n.bones,
            version: n.version,
            currentAnim: n.currentAnim,
            premultipliedAlpha: n.premultipliedAlpha,
            _srcSkelJson: n._srcSkelJson,
            _srcSkelBinBase64: n._srcSkelBinBase64,
            _srcAtlasText: n._srcAtlasText,
            _srcTexDataUrl: n._srcTexDataUrl,
            _srcType: n._srcType,
            _textContent: n._textContent,
            _exitText: n._exitText
        });
        result = nodesIter.next();
    }

    return JSON.stringify(data, null, 2);
};

// ---- 显示保存提示气泡（左下角） ----
SMTool._showSaveToast = function (msg) {
    var toast = document.getElementById('autoSaveToast');
    if (!toast) return;

    // 更新提示文本
    var textEl = toast.querySelector('.ast-text');
    if (textEl) textEl.textContent = msg || '已保存';

    // 重置动画：先移除再强制回流后添加
    toast.classList.remove('show');
    void toast.offsetWidth; // 强制回流
    toast.classList.add('show');

    // 2.5 秒后自动消失
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function () {
        toast.classList.remove('show');
    }, 2500);
};

// ---- 使用 File System Access API 静默写入文件 ----
SMTool._writeFileSilently = function () {
    if (!SMData._saveFileHandle) return Promise.reject('no handle');

    var json = SMTool._serializeData();
    var blob = new Blob([json], { type: 'application/json' });

    return SMData._saveFileHandle.createWritable().then(function (writable) {
        return writable.write(blob).then(function () {
            return writable.close();
        });
    });
};

// ---- 通过浏览器下载（降级方案） ----
SMTool._downloadFile = function (filename) {
    var json = SMTool._serializeData();
    var b = new Blob([json], { type: 'application/json' });
    var u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u;
    a.download = filename || 'spine-state-machine.json';
    a.click();
    URL.revokeObjectURL(u);
};

// ---- 开始自动保存（每 30 秒） ----
SMTool._startAutoSave = function () {
    if (SMData._autoSaveIntervalId) return; // 已在运行
    SMData._autoSaveIntervalId = setInterval(function () {
        // 只有在已经手动保存过文件的前提下才自动保存
        if (!SMData._hasEverSaved || SMData.nodes.size === 0) return;

        if (SMData._saveFileHandle) {
            // 有文件句柄 → 静默覆盖写入，不弹窗
            SMTool._writeFileSilently().then(function () {
                SMTool._showSaveToast('已自动保存');
            }).catch(function (err) {
                console.error('[AutoSave] 静默保存失败:', err);
                // 句柄失效时回退到下载方式
                SMTool._downloadFile('spine-state-machine.json');
                SMTool._showSaveToast('已自动保存');
            });
        } else {
            // 无文件句柄（降级）→ 触发下载
            SMTool._downloadFile('spine-state-machine.json');
            SMTool._showSaveToast('已自动保存');
        }
    }, 30000); // 半分钟 = 30 秒
};

// ---- 停止自动保存 ----
SMTool._stopAutoSave = function () {
    if (SMData._autoSaveIntervalId) {
        clearInterval(SMData._autoSaveIntervalId);
        SMData._autoSaveIntervalId = null;
    }
};

// ---- 导出项目（手动触发：点击按钮或 CTRL+S） ----
SMTool.exportData = function () {
    // 场景中没有任何内容时不执行保存
    if (SMData.nodes.size === 0) return;

    // 如果已有文件句柄 → 静默覆写（用户之前已选过保存位置）
    if (SMData._saveFileHandle) {
        SMTool._writeFileSilently().then(function () {
            SMTool._showSaveToast('已保存');
        }).catch(function (err) {
            console.error('[Export] 静默保存失败:', err);
            // 句柄失效 → 让用户重新选择位置
            SMData._saveFileHandle = null;
            SMTool.exportData();
        });
        return;
    }

    // 首次保存：使用 File System Access API 让用户选择保存位置
    if (window.showSaveFilePicker) {
        var opts = {
            suggestedName: 'spine-state-machine.json',
            types: [{
                description: 'JSON 文件',
                accept: { 'application/json': ['.json'] }
            }]
        };

        window.showSaveFilePicker(opts).then(function (handle) {
            SMData._saveFileHandle = handle;

            // 写入文件
            var json = SMTool._serializeData();
            var blob = new Blob([json], { type: 'application/json' });
            return handle.createWritable().then(function (writable) {
                return writable.write(blob).then(function () {
                    return writable.close();
                });
            });
        }).then(function () {
            // 标记已保存，并启动自动保存定时器
            if (!SMData._hasEverSaved) {
                SMData._hasEverSaved = true;
                SMTool._startAutoSave();
            }
            SMTool._showSaveToast('已保存');
        }).catch(function (err) {
            if (err.name !== 'AbortError') {
                console.error('[Export] 保存失败:', err);
                // 降级：使用传统下载方式
                SMTool._downloadFile('spine-state-machine.json');
                if (!SMData._hasEverSaved) {
                    SMData._hasEverSaved = true;
                    SMTool._startAutoSave();
                }
                SMTool._showSaveToast('已保存');
            }
        });
    } else {
        // 浏览器不支持 File System Access API → 降级为传统下载
        SMTool._downloadFile('spine-state-machine.json');

        if (!SMData._hasEverSaved) {
            SMData._hasEverSaved = true;
            SMTool._startAutoSave();
        }

        SMTool._showSaveToast('已保存');
    }
};

// ---- 导入项目 ----
SMTool.importData = function () {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = function (e) {
        var f = e.target.files[0];
        if (!f) return;

        var r = new FileReader();
        r.onload = function () {
            try {
                SMTool.pushUndo();
                var d = JSON.parse(r.result);

                // 恢复视图
                if (d.view) SMData.view = d.view;

                // 恢复连线
                SMData.connections = d.connections || [];

                // 恢复节点
                var nodeList = d.nodes || [];
                for (var i = 0; i < nodeList.length; i++) {
                    var nd = nodeList[i];
                    var node = new SpineNodeData(nd.id);
                    node.name = nd.name;
                    node.nodeType = nd.nodeType || 'spine';
                    node.x = nd.x || 0;
                    node.y = nd.y || 0;
                    node.animations = nd.animations || [];
                    node.skins = nd.skins || [];
                    node.slots = nd.slots || [];
                    node.bones = nd.bones || [];
                    node.version = nd.version || '';
                    node.currentAnim = nd.currentAnim || '';
                    node.premultipliedAlpha = nd.premultipliedAlpha || false;
                    node._srcSkelJson = nd._srcSkelJson || null;
                    node._srcSkelBinBase64 = nd._srcSkelBinBase64 || null;
                    node._srcAtlasText = nd._srcAtlasText || '';
                    node._srcTexDataUrl = nd._srcTexDataUrl || '';
                    node._srcTexDataUrls = nd._srcTexDataUrls || [];
                    node._srcType = nd._srcType || '';
                    node._textContent = nd._textContent || '';
                    node._exitText = nd._exitText || '';

                    SMData.nodes.set(nd.id, node);
                    SMData.nextId = Math.max(SMData.nextId, nd.id + 1);

                    SMTool._createEl(node);
                    SMTool._updatePos(node);

                    // 恢复 WebGL 渲染
                    if (node._srcAtlasText && (node._srcTexDataUrl || (node._srcTexDataUrls && node._srcTexDataUrls.length > 0)) &&
                        (node._srcSkelJson || node._srcSkelBinBase64)) {
                        SMTool._loadFromSourceData(node).then(function () {
                            SMTool._updateEl(node);
                        }).catch(function (err) {
                            console.error('[Import] Failed to restore rendering:', err);
                        });
                    }
                }

                // 更新 ID 计数器
                var maxConnId = 0;
                for (var j = 0; j < SMData.connections.length; j++) {
                    maxConnId = Math.max(maxConnId, SMData.connections[j].id);
                }
                SMData.nextConnId = maxConnId + 1;

                SMTool._updateAllPos();
                SMTool._updateSB();
                SMTool._updateStateRowColors();

            } catch (err) {
                alert('导入失败：无效的 JSON 文件\n' + err.message);
            }
        };
        r.readAsText(f);
    };
    inp.click();
};
