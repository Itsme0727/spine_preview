/* ================================================================
   导出/导入 — JSON 项目文件序列化与反序列化
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 导出项目 ----
SMTool.exportData = function () {
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
            _srcType: n._srcType
        });
        result = nodesIter.next();
    }

    // 下载
    var j = JSON.stringify(data, null, 2);
    var b = new Blob([j], { type: 'application/json' });
    var u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u;
    a.download = 'spine-state-machine.json';
    a.click();
    URL.revokeObjectURL(u);
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
                    node._srcType = nd._srcType || '';

                    SMData.nodes.set(nd.id, node);
                    SMData.nextId = Math.max(SMData.nextId, nd.id + 1);

                    SMTool._createEl(node);
                    SMTool._updatePos(node);

                    // 恢复 WebGL 渲染
                    if (node._srcAtlasText && node._srcTexDataUrl &&
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
