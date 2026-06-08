/* ================================================================
   AI 可读动画流 JSON 导出
   将所有动画流组合、节点参数、连线条件导出为结构化 JSON
   方便 AI 理解整个动画状态机逻辑和细节参数
   挂载到 SMTool 上
   ================================================================ */

var SMTool = window.SMTool || {};

// ---- 找出所有源头节点（无入边连线）和孤立节点 ----
SMTool._findAllSourceNodes = function () {
    var hasIncoming = {};
    var hasOutgoing = {};
    var nodesIter = SMData.nodes.values();
    var r = nodesIter.next();
    while (!r.done) {
        hasIncoming[r.value.id] = false;
        r = nodesIter.next();
    }
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (hasIncoming.hasOwnProperty(c.toNode)) hasIncoming[c.toNode] = true;
        hasOutgoing[c.fromNode] = true;
    }
    var sources = [];
    var isolated = [];
    var nodesIter2 = SMData.nodes.values();
    var r2 = nodesIter2.next();
    while (!r2.done) {
        var node = r2.value;
        var nid = node.id;
        if (!hasIncoming[nid]) {
            if (hasOutgoing[nid]) sources.push({ id: nid, nodeType: node.nodeType });
            else isolated.push({ id: nid, nodeType: node.nodeType });
        }
        r2 = nodesIter2.next();
    }
    return { sources: sources, isolated: isolated };
};

// ---- 获取节点的显示名称 ----
SMTool._aiNodeDisplayName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return '入口';
    if (node.nodeType === 'exit') return '出口';
    if (node.nodeType === 'titleText') return node._textContent || '标题';
    var transName = SMTool._translateName(node.currentAnim);
    if (transName && transName !== node.currentAnim) return transName;
    return node.name || ('Node_' + node.id);
};

// ---- 获取节点代表的动画状态名 ----
SMTool._aiStateName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return 'entry';
    if (node.nodeType === 'exit') return 'exit';
    if (node.nodeType === 'shortText' || node.nodeType === 'textBox') return 'text_' + node.id;
    if (node.nodeType === 'titleText') return 'title_' + node.id;
    if (node.nodeType === 'layer') return 'layer_' + node.id;
    return node.currentAnim || (node.animations && node.animations.length > 0 ? node.animations[0].name : node.name);
};

// ---- 获取截图引用路径列表 ----
SMTool._aiShotRefs = function (shotRefs, name) {
    if (!shotRefs || !shotRefs[name]) return [];
    var raw = shotRefs[name];
    var arr = Array.isArray(raw) ? raw : [raw];
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] && typeof arr[i] === 'string') result.push(arr[i]);
    }
    return result;
};

// ---- 检查是否有标记内容（tags/notes/screenshots/fade） ----
SMTool._aiIsMarked = function (tags, notes, screenshots, shotRefs, fade, name) {
    if (tags && tags[name] && Array.isArray(tags[name]) && tags[name].length > 0) return true;
    if (notes && notes[name] && typeof notes[name] === 'string' && notes[name].trim().length > 0) return true;
    if (screenshots && screenshots[name]) {
        var ss = screenshots[name];
        if (Array.isArray(ss) && ss.length > 0) return true;
        if (typeof ss === 'number') return true;
    }
    if (SMTool._aiShotRefs(shotRefs, name).length > 0) return true;
    if (fade && fade[name] && fade[name].enabled) return true;
    return false;
};

// ---- 构建标记项详情（骨骼/皮肤/插槽通用） ----
SMTool._aiBuildMarkedDetail = function (name, tags, notes, shotRefs, fade) {
    var tagsArr = (tags && tags[name]) ? tags[name] : [];
    if (!Array.isArray(tagsArr)) tagsArr = tagsArr ? [tagsArr] : [];
    var noteText = (notes && notes[name]) ? notes[name] : '';
    var fadeData = (fade && fade[name]) || { enabled: false, duration: 1.0 };
    var shotRefsArr = SMTool._aiShotRefs(shotRefs, name);
    return {
        tags: tagsArr,
        note: noteText,
        screenshots: shotRefsArr,
        fadeInOut: {
            enabled: fadeData.enabled || false,
            durationSeconds: fadeData.duration || 1.0
        }
    };
};

// ---- 序列化单个节点为 AI 友好的 JSON ----
SMTool._serializeNodeForAI = function (node) {
    var obj = {
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.nodeType,
        displayName: SMTool._aiNodeDisplayName(node)
    };

    if (node.nodeType === 'spine') {
        obj.sourceFile = node.sourceFile || '';
        obj.currentAnimation = node.currentAnim || '';
        obj.chineseTranslation = SMTool._translateName(node.currentAnim) || node.currentAnim || '';
        var animDur = 0;
        for (var ai = 0; ai < node.animations.length; ai++) {
            if (node.animations[ai].name === node.currentAnim) { animDur = node.animations[ai].duration; break; }
        }
        obj.animationDurationSeconds = animDur;
        obj.allAnimations = [];
        for (var ai2 = 0; ai2 < node.animations.length; ai2++) {
            obj.allAnimations.push({ name: node.animations[ai2].name, durationSeconds: node.animations[ai2].duration });
        }
        obj.loopMode = node.loop !== false ? '循环播放' : '单次播放';
        obj.premultipliedAlpha = node.premultipliedAlpha || false;
        obj.currentSkin = node.currentSkin || '';
        obj.stateDescription = node._stateDesc || '';

        // 轨道混合
        if (!node.tracks || node.tracks.length === 0) SMTool._initDefaultTracks(node);
        obj.trackMixing = [];
        for (var ti = 0; ti < node.tracks.length; ti++) {
            var t = node.tracks[ti];
            obj.trackMixing.push({
                trackIndex: ti,
                animationName: t.animName || '',
                alpha: (t.alpha !== undefined ? t.alpha : 1.0),
                mixBlend: t.mixBlend || 'replace',
                mixDurationSeconds: (t.mixDuration !== undefined ? t.mixDuration : 0),
                loop: t.loop !== false,
                enabled: t.enabled !== false
            });
        }

        // 皮肤标记（仅已标记的）
        var skinsArr = [];
        for (var ski = 0; ski < (node.skins || []).length; ski++) {
            var skn = node.skins[ski];
            if (SMTool._aiIsMarked(node._skinTags, node._skinNotes, node._skinScreenshots, node._skinShotRefs, node._skinFade, skn)) {
                var sd = SMTool._aiBuildMarkedDetail(skn, node._skinTags, node._skinNotes, node._skinShotRefs, node._skinFade);
                sd.skinName = skn;
                skinsArr.push(sd);
            }
        }
        if (skinsArr.length > 0) obj.skins = skinsArr;

        // 骨骼标记（仅已标记的）
        var bonesArr = [];
        for (var bi = 0; bi < (node.bones || []).length; bi++) {
            var bn = node.bones[bi];
            if (SMTool._aiIsMarked(node._boneTags, node._boneNotes, node._boneScreenshots, node._boneShotRefs, node._boneFade, bn)) {
                var bd = SMTool._aiBuildMarkedDetail(bn, node._boneTags, node._boneNotes, node._boneShotRefs, node._boneFade);
                bd.boneName = bn;
                bonesArr.push(bd);
            }
        }
        if (bonesArr.length > 0) obj.bones = bonesArr;

        // 插槽标记（仅已标记的）
        var slotsArr = [];
        for (var sli = 0; sli < (node.slots || []).length; sli++) {
            var sln = node.slots[sli];
            if (SMTool._aiIsMarked(node._slotTags, node._slotNotes, node._slotScreenshots, node._slotShotRefs, node._slotFade, sln)) {
                var sld = SMTool._aiBuildMarkedDetail(sln, node._slotTags, node._slotNotes, node._slotShotRefs, node._slotFade);
                sld.slotName = sln;
                slotsArr.push(sld);
            }
        }
        if (slotsArr.length > 0) obj.slots = slotsArr;

        // 事件帧
        SMTool._ensureEventFrames(node);
        if (node._eventFrames && node._eventFrames.length > 0) {
            obj.eventFrames = [];
            for (var efi = 0; efi < node._eventFrames.length; efi++) {
                obj.eventFrames.push({ timeSeconds: node._eventFrames[efi].time, eventName: node._eventFrames[efi].name });
            }
        }

        if (node._customScale && node._customScale !== 1.0) obj.customScale = node._customScale;

    } else if (node.nodeType === 'entry' || node.nodeType === 'exit') {
        obj.exitText = node._exitText || '';
    } else if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
        obj.textContent = node._textContent || '';
    } else if (node.nodeType === 'titleText') {
        obj.titleText = node._textContent || '';
    } else if (node.nodeType === 'layer') {
        var ld = SMTool._layerData(node);
        obj.layerCount = ld.layerCount || 0;
        obj.layers = [];
        for (var lj = 1; lj <= ld.layerCount; lj++) {
            var layerInfo = ld.layers[lj];
            var layerObj = { layerNumber: lj };
            if (layerInfo && layerInfo.animNodeId) {
                layerObj.connectedNodeId = layerInfo.animNodeId;
                layerObj.connectedAnimationName = layerInfo.animName || '';
                var linkedNode = SMData.nodes.get(layerInfo.animNodeId);
                layerObj.connectedNodeDisplayName = linkedNode ? SMTool._aiNodeDisplayName(linkedNode) : '';
            } else {
                layerObj.connectedNodeId = null;
                layerObj.connectedAnimationName = '';
            }
            obj.layers.push(layerObj);
        }
    }
    return obj;
};

// ---- 序列化连线为 AI 友好的 JSON ----
SMTool._serializeConnectionForAI = function (connId) {
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (c.id === connId) {
            return {
                connectionId: c.id,
                fromNodeId: c.fromNode,
                toNodeId: c.toNode,
                fromState: c.fromState || '',
                toState: c.toState || '',
                condition: c.condition || ''
            };
        }
    }
    return null;
};

// ---- 生成路径的人类可读表达式 ----
SMTool._aiPathExpression = function (path) {
    var parts = [];
    for (var si = 0; si < path.nodes.length; si++) {
        var sn = path.nodes[si];
        parts.push(sn.anim || ('#' + sn.id));
        if (si < path.nodes.length - 1) {
            var conn = SMTool._serializeConnectionForAI(path.conns[si]);
            var cond = (conn && conn.condition) ? conn.condition : '(无条件)';
            parts.push('→ [' + cond + '] →');
        }
    }
    return parts.join(' ');
};

// ================================================================
//   主导出函数：exportAIJson()
//   遍历画布所有动画流，生成 AI 可读的结构化 JSON 并下载
// ================================================================
SMTool.exportAIJson = function () {
    if (SMData.nodes.size === 0) { SMTool._showSaveToast('画布无节点，无法导出'); return; }

    var sourceResult = SMTool._findAllSourceNodes();
    var allSources = sourceResult.sources;
    var allIsolated = sourceResult.isolated;
    var animationFlows = [];
    var flowIdx = 0;

    // 为每个源头构建动画流
    for (var si = 0; si < allSources.length; si++) {
        var src = allSources[si];
        var srcNode = SMData.nodes.get(src.id);
        if (!srcNode) continue;
        var paths = SMTool._findAllFullPaths(src.id);
        flowIdx++;
        var flow = {
            flowId: 'flow_' + flowIdx,
            sourceNodeId: src.id,
            sourceNodeType: src.nodeType,
            sourceStateName: SMTool._aiStateName(srcNode),
            sourceDisplayName: SMTool._aiNodeDisplayName(srcNode),
            totalPaths: paths.length
        };
        if (paths.length === 0) {
            flow.flowDescription = '源头 "' + flow.sourceDisplayName + '" 无下游路径';
        } else {
            var pathDescs = [];
            for (var pi = 0; pi < Math.min(paths.length, 5); pi++) {
                var seqNames = [];
                for (var ni = 0; ni < paths[pi].nodes.length; ni++) seqNames.push(paths[pi].nodes[ni].anim || ('#' + paths[pi].nodes[ni].id));
                pathDescs.push(seqNames.join(' > '));
            }
            if (paths.length > 5) pathDescs.push('...共 ' + paths.length + ' 条路径');
            flow.flowDescription = '源头 "' + flow.sourceDisplayName + '" → ' + pathDescs.join(' | ');
        }

        var nodesInFlow = {};
        var collectNode = function (nid) {
            if (nodesInFlow[nid]) return;
            var nd = SMData.nodes.get(nid);
            if (nd) nodesInFlow[nid] = SMTool._serializeNodeForAI(nd);
        };
        collectNode(src.id);
        for (var pj = 0; pj < paths.length; pj++) {
            for (var nk = 0; nk < paths[pj].nodes.length; nk++) collectNode(paths[pj].nodes[nk].id);
        }
        flow.nodes = nodesInFlow;

        flow.paths = [];
        for (var pk = 0; pk < paths.length; pk++) {
            var pathData = paths[pk];
            var pathObj = { pathIndex: pk, pathExpression: SMTool._aiPathExpression(pathData), isCycle: false, steps: [] };
            var lastNode = pathData.nodes[pathData.nodes.length - 1];
            if (lastNode && lastNode.cycleClose) pathObj.isCycle = true;
            for (var sti = 0; sti < pathData.nodes.length; sti++) {
                var sn = pathData.nodes[sti];
                var stepNode = SMData.nodes.get(sn.id);
                pathObj.steps.push({
                    kind: 'node',
                    nodeId: sn.id,
                    nodeType: stepNode ? stepNode.nodeType : 'unknown',
                    stateName: sn.anim || (stepNode ? SMTool._aiStateName(stepNode) : '?'),
                    displayName: stepNode ? SMTool._aiNodeDisplayName(stepNode) : (sn.anim || '?'),
                    isCycleClose: sn.cycleClose || false
                });
                if (sti < pathData.nodes.length - 1 && sti < pathData.conns.length) {
                    var connAI = SMTool._serializeConnectionForAI(pathData.conns[sti]);
                    if (connAI) pathObj.steps.push({
                        kind: 'transition',
                        connectionId: connAI.connectionId,
                        fromNodeId: connAI.fromNodeId,
                        toNodeId: connAI.toNodeId,
                        fromState: connAI.fromState,
                        toState: connAI.toState,
                        condition: connAI.condition
                    });
                }
            }
            flow.paths.push(pathObj);
        }
        animationFlows.push(flow);
    }

    // 孤立节点作为独立 flow
    for (var ii = 0; ii < allIsolated.length; ii++) {
        var iso = allIsolated[ii];
        var isoNode = SMData.nodes.get(iso.id);
        if (!isoNode) continue;
        flowIdx++;
        var nodesObj = {};
        nodesObj[iso.id] = SMTool._serializeNodeForAI(isoNode);
        animationFlows.push({
            flowId: 'flow_isolated_' + flowIdx,
            sourceNodeId: iso.id,
            sourceNodeType: iso.nodeType,
            sourceStateName: SMTool._aiStateName(isoNode),
            sourceDisplayName: SMTool._aiNodeDisplayName(isoNode),
            flowDescription: '孤立节点 "' + SMTool._aiNodeDisplayName(isoNode) + '"（无连线）',
            totalPaths: 0,
            nodes: nodesObj,
            paths: []
        });
    }

    var totalFlows = animationFlows.length;
    var totalPathCount = 0;
    for (var fi = 0; fi < animationFlows.length; fi++) totalPathCount += animationFlows[fi].paths.length;

    var result = {
        exportType: 'ai_animation_flow_documentation',
        exportVersion: '1.0',
        exportDate: new Date().toISOString(),
        projectSummary: {
            totalNodes: SMData.nodes.size,
            totalConnections: SMData.connections.length,
            totalAnimationFlows: totalFlows,
            totalAnimationPaths: totalPathCount,
            renderMode: SMData.renderMode || 'perf',
            flowMode: SMData.flowMode || 'full'
        },
        animationFlows: animationFlows
    };

    var jsonStr = JSON.stringify(result, null, 2);
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'animation-flow-ai.json';
    a.click();
    URL.revokeObjectURL(url);
    SMTool._showSaveToast('已导出 AI JSON（' + totalFlows + ' 个动画流, ' + totalPathCount + ' 条路径）');
};
