/* ================================================================
   AI 可读动画流 JSON 导出 v2
   以"组"为最大组织单元，组内按排序索引排列
   动画流路径中的状态按流程顺序排列，不暴露画布内部 ID
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

// ---- 计算组的排序索引（与 _renderGroupBoxes 逻辑一致） ----
// 返回 { groupId: "1" | "2" | "2_2" | ... }
SMTool._computeGroupSortIndices = function () {
    var groupBounds = [];
    for (var i = 0; i < SMData.groups.length; i++) {
        var g = SMData.groups[i];
        var bb = SMTool._getGroupBounds(g);
        if (bb) groupBounds.push({ g: g, bb: bb });
    }
    groupBounds.sort(function (a, b) {
        var dY = a.bb.top - b.bb.top;
        if (Math.abs(dY) < 0.5) return a.bb.left - b.bb.left;
        return dY;
    });
    var sortMap = {};
    var currentBase = 0;
    var currentBaseTop = -Infinity;
    var sameRowCount = 0;
    var THRESHOLD = 50;
    for (var si = 0; si < groupBounds.length; si++) {
        var item = groupBounds[si];
        if (si === 0 || Math.abs(item.bb.top - currentBaseTop) > THRESHOLD) {
            currentBase++;
            currentBaseTop = item.bb.top;
            sameRowCount = 1;
            sortMap[item.g.id] = '' + currentBase;
        } else {
            sameRowCount++;
            sortMap[item.g.id] = currentBase + '_' + sameRowCount;
        }
    }
    return sortMap;
};

// ---- 获取节点的显示名称 ----
SMTool._aiNodeDisplayName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return '入口';
    if (node.nodeType === 'exit') return '出口';
    if (node.nodeType === 'titleText') return node._textContent || '标题';
    var transName = SMTool._translateName(node.currentAnim);
    if (transName && transName !== node.currentAnim) return transName;
    return node.name || '';
};

// ---- 获取节点代表的动画状态名 ----
SMTool._aiStateName = function (node) {
    if (!node) return '?';
    if (node.nodeType === 'entry') return 'entry';
    if (node.nodeType === 'exit') return 'exit';
    if (node.nodeType === 'shortText' || node.nodeType === 'textBox') return '(文本)';
    if (node.nodeType === 'titleText') return '(标题)';
    if (node.nodeType === 'layer') return '(层级)';
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

// ---- 检查是否有标记内容 ----
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

// ---- 构建标记项详情 ----
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

// ---- 序列化单个状态为 step（sourceFile 和 stateName 置顶） ----
SMTool._serializeStepForAI = function (node) {
    var obj = {};

    if (node.nodeType === 'spine') {
        // ★ 源文件名
        obj.sourceFile = node.sourceFile || '';
        // ★ 状态名（英文 + 中文翻译 紧邻）
        obj.stateName = node.currentAnim || '';
        obj.chineseTranslation = SMTool._translateName(node.currentAnim) || node.currentAnim || '';
        // 显示名 + 类型
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.nodeType = 'spine';
        var animDur = 0;
        for (var ai = 0; ai < node.animations.length; ai++) {
            if (node.animations[ai].name === node.currentAnim) { animDur = node.animations[ai].duration; break; }
        }
        obj.animationDurationSeconds = animDur;
        obj.loopMode = node.loop !== false ? '循环播放' : '单次播放';
        obj.premultipliedAlpha = node.premultipliedAlpha || false;
        obj.currentSkin = node.currentSkin || '';
        obj.stateDescription = node._stateDesc || '';

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

        SMTool._ensureEventFrames(node);
        if (node._eventFrames && node._eventFrames.length > 0) {
            obj.eventFrames = [];
            for (var efi = 0; efi < node._eventFrames.length; efi++) {
                obj.eventFrames.push({ timeSeconds: node._eventFrames[efi].time, eventName: node._eventFrames[efi].name });
            }
        }

        if (node._customScale && node._customScale !== 1.0) obj.customScale = node._customScale;

    } else if (node.nodeType === 'entry' || node.nodeType === 'exit') {
        obj.nodeType = node.nodeType;
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.entryExitText = node._exitText || '';
    } else if (node.nodeType === 'shortText' || node.nodeType === 'textBox') {
        obj.nodeType = node.nodeType;
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.textContent = node._textContent || '';
    } else if (node.nodeType === 'titleText') {
        obj.nodeType = 'titleText';
        obj.displayName = SMTool._aiNodeDisplayName(node);
        obj.titleText = node._textContent || '';
    } else if (node.nodeType === 'layer') {
        obj.nodeType = 'layer';
        obj.displayName = SMTool._aiNodeDisplayName(node);
        var ld = SMTool._layerData(node);
        obj.layerCount = ld.layerCount || 0;
        obj.layers = [];
        for (var lj = 1; lj <= ld.layerCount; lj++) {
            var layerInfo = ld.layers[lj];
            var layerObj = { layerNumber: lj };
            if (layerInfo && layerInfo.animNodeId) {
                layerObj.connectedAnimationName = layerInfo.animName || '';
                var linkedNode = SMData.nodes.get(layerInfo.animNodeId);
                layerObj.connectedDisplayName = linkedNode ? SMTool._aiNodeDisplayName(linkedNode) : '';
            } else {
                layerObj.connectedAnimationName = '';
            }
            obj.layers.push(layerObj);
        }
    }
    return obj;
};

// ---- 序列化连线（仅保留条件文本，不暴露内部 ID） ----
SMTool._serializeConnForAI = function (connId) {
    for (var i = 0; i < SMData.connections.length; i++) {
        var c = SMData.connections[i];
        if (c.id === connId) return { condition: c.condition || '' };
    }
    return { condition: '' };
};

// ---- 为一个源头构建所有动画流（每个 path 一个独立的自包含流） ----
SMTool._buildFlowsForSource = function (srcNode, startFlowIdx) {
    var paths = SMTool._findAllFullPaths(srcNode.id);
    var flowsOut = [];

    if (paths.length === 0) {
        // 无下游路径 → 单节点流
        var srcLabel = SMTool._aiNodeDisplayName(srcNode);
        var srcSF = srcNode.sourceFile ? '[' + srcNode.sourceFile + '] ' : '';
        var soloFlow = {
            flowIndex: startFlowIdx,
            flowExpression: srcSF + srcLabel + '（无下游）',
            isCycle: false,
            steps: [SMTool._serializeStepForAI(srcNode)]
        };
        soloFlow.steps[0].stepIndex = 0;
        flowsOut.push(soloFlow);
        return flowsOut;
    }

    for (var pk = 0; pk < paths.length; pk++) {
        var pathData = paths[pk];
        var flowIdx = startFlowIdx + pk;

        // 构建 flowExpression（含源文件名标注）
        var exprParts = [];
        for (var si = 0; si < pathData.nodes.length; si++) {
            var nd = SMData.nodes.get(pathData.nodes[si].id);
            var label = nd ? SMTool._aiNodeDisplayName(nd) : (pathData.nodes[si].anim || '?');
            // ★ 标注动画文件名
            var sf = (nd && nd.sourceFile) ? '[' + nd.sourceFile + '] ' : '';
            exprParts.push(sf + label);
            if (si < pathData.nodes.length - 1) {
                var connPre = SMTool._serializeConnForAI(pathData.conns[si]);
                exprParts.push('→ (' + (connPre.condition || '无条件') + ') →');
            }
        }

        var flowObj = {
            flowIndex: flowIdx,
            flowExpression: exprParts.join(' '),
            isCycle: false,
            steps: []
        };

        var lastNode = pathData.nodes[pathData.nodes.length - 1];
        if (lastNode && lastNode.cycleClose) flowObj.isCycle = true;

        // 内联所有 node 参数 + transition 条件到 steps
        for (var sti = 0; sti < pathData.nodes.length; sti++) {
            var sn = pathData.nodes[sti];
            var stepNode = SMData.nodes.get(sn.id);

            var stepObj = SMTool._serializeStepForAI(stepNode || { nodeType: 'spine', name: sn.anim || '?', currentAnim: sn.anim || '', animations: [] });
            stepObj.stepIndex = sti;
            stepObj.isCycleClose = sn.cycleClose || false;
            flowObj.steps.push(stepObj);

            if (sti < pathData.nodes.length - 1 && sti < pathData.conns.length) {
                var connObj = SMTool._serializeConnForAI(pathData.conns[sti]);
                connObj.kind = 'transition';
                flowObj.steps.push(connObj);
            }
        }

        flowsOut.push(flowObj);
    }
    return flowsOut;
};

// ================================================================
//   主导出：exportAIJson() v2 — 以组为最大单元，每个动画流自包含
// ================================================================
SMTool.exportAIJson = function () {
    if (SMData.nodes.size === 0) { SMTool._showSaveToast('画布无节点，无法导出'); return; }

    var groupSortMap = SMTool._computeGroupSortIndices();

    var nodeGroupMap = {};
    for (var gi = 0; gi < SMData.groups.length; gi++) {
        var grp = SMData.groups[gi];
        var arr = [];
        grp.nodeIds.forEach(function (nid) { arr.push(nid); });
        for (var ni = 0; ni < arr.length; ni++) {
            nodeGroupMap[arr[ni]] = { groupId: grp.id, groupObj: grp };
        }
    }

    var sourceResult = SMTool._findAllSourceNodes();
    var allSources = sourceResult.sources;
    var allIsolated = sourceResult.isolated;

    var groupSources = {};
    var ungroupedSources = [];
    var ungroupedIsolated = [];

    for (var si = 0; si < allSources.length; si++) {
        var src = allSources[si];
        var info = nodeGroupMap[src.id];
        if (info) {
            var gid = info.groupId;
            if (!groupSources[gid]) groupSources[gid] = { groupObj: info.groupObj, sortIdx: groupSortMap[gid] || '?', sources: [], isolated: [] };
            groupSources[gid].sources.push(src);
        } else {
            ungroupedSources.push(src);
        }
    }
    for (var ii = 0; ii < allIsolated.length; ii++) {
        var iso = allIsolated[ii];
        var info2 = nodeGroupMap[iso.id];
        if (info2) {
            var gid2 = info2.groupId;
            if (!groupSources[gid2]) groupSources[gid2] = { groupObj: info2.groupObj, sortIdx: groupSortMap[gid2] || '?', sources: [], isolated: [] };
            groupSources[gid2].isolated.push(iso);
        } else {
            ungroupedIsolated.push(iso);
        }
    }

    var groupIds = Object.keys(groupSources);
    groupIds.sort(function (a, b) {
        var sa = groupSources[a].sortIdx;
        var sb = groupSources[b].sortIdx;
        var na = parseFloat(sa) || 0;
        var nb = parseFloat(sb) || 0;
        if (na !== nb) return na - nb;
        return (sa || '').localeCompare(sb || '');
    });

    var totalFlows = 0;
    var groupFlowIdx = 0;
    var groupsOutput = [];

    // 辅助：为孤立节点创建单节点流
    var _makeIsoFlow = function (node) {
        groupFlowIdx++;
        var sfLabel = (node.sourceFile) ? '[' + node.sourceFile + '] ' : '';
        return {
            flowIndex: groupFlowIdx,
            flowExpression: sfLabel + SMTool._aiNodeDisplayName(node) + '（独立，无连线）',
            isCycle: false,
            steps: [SMTool._serializeStepForAI(node)]
        };
    };

    for (var gi2 = 0; gi2 < groupIds.length; gi2++) {
        var gid = groupIds[gi2];
        var gs = groupSources[gid];
        var grp = gs.groupObj;
        var flowsArr = [];

        // 组内的源头 → 构建动画流（每个 path 一个独立流）
        for (var sj = 0; sj < gs.sources.length; sj++) {
            var srcNode = SMData.nodes.get(gs.sources[sj].id);
            if (!srcNode) continue;
            var newFlows = SMTool._buildFlowsForSource(srcNode, groupFlowIdx + 1);
            groupFlowIdx += newFlows.length;
            for (var nf = 0; nf < newFlows.length; nf++) flowsArr.push(newFlows[nf]);
        }
        // 组内的孤立节点
        for (var ik = 0; ik < gs.isolated.length; ik++) {
            var isoNode = SMData.nodes.get(gs.isolated[ik].id);
            if (!isoNode) continue;
            var isoFlow = _makeIsoFlow(isoNode);
            if (isoFlow.steps[0]) isoFlow.steps[0].stepIndex = 0;
            flowsArr.push(isoFlow);
        }

        if (flowsArr.length === 0) continue;
        totalFlows += flowsArr.length;

        groupsOutput.push({
            sortIndex: gs.sortIdx,
            title: grp.title || '',
            color: grp.color || '',
            nodeCount: grp.nodeIds ? grp.nodeIds.size : 0,
            animationFlows: flowsArr
        });
    }

    // 未打组的节点
    var ungroupedFlows = [];
    for (var uj = 0; uj < ungroupedSources.length; uj++) {
        var usrcNode = SMData.nodes.get(ungroupedSources[uj].id);
        if (!usrcNode) continue;
        var uFlows = SMTool._buildFlowsForSource(usrcNode, groupFlowIdx + 1);
        groupFlowIdx += uFlows.length;
        for (var nf2 = 0; nf2 < uFlows.length; nf2++) ungroupedFlows.push(uFlows[nf2]);
    }
    for (var uk = 0; uk < ungroupedIsolated.length; uk++) {
        var uisoNode = SMData.nodes.get(ungroupedIsolated[uk].id);
        if (!uisoNode) continue;
        var uisoFlow = _makeIsoFlow(uisoNode);
        if (uisoFlow.steps[0]) uisoFlow.steps[0].stepIndex = 0;
        ungroupedFlows.push(uisoFlow);
    }
    totalFlows += ungroupedFlows.length;

    var result = {
        exportType: 'ai_animation_flow_documentation',
        exportVersion: '2.0',
        exportDate: new Date().toISOString(),
        projectSummary: {
            totalGroups: SMData.groups.length,
            totalAnimationFlows: totalFlows,
            renderMode: SMData.renderMode || 'perf',
            flowMode: SMData.flowMode || 'full'
        },
        groups: groupsOutput
    };
    if (ungroupedFlows.length > 0) result.ungrouped = { animationFlows: ungroupedFlows };

    var jsonStr = JSON.stringify(result, null, 2);
    var blob = new Blob([jsonStr], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'animation-flow-ai.json';
    a.click();
    URL.revokeObjectURL(url);
    SMTool._showSaveToast('已导出 AI JSON v2（' + groupsOutput.length + ' 组, ' + totalFlows + ' 个动画流）');
};
