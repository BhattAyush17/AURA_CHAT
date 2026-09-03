(() => {
  if (window.__audioProbeInstalled) return;
  window.__audioProbeInstalled = true;

  window.__audioProbe = {
    ctxs: [],
    nodes: [],
    speechSynthesisSpeaks: 0,
    _nodeId: 0,
  };

  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC && !AC.__patched) {
    const OrigAC = AC;
    const NewAC = function (...args) {
      const ctx = new OrigAC(...args);
      const rec = {
        id: window.__audioProbe.ctxs.length,
        ctx,
        created: performance.now(),
        closed: false,
        suspendedCount: 0,
      };
      ctx.addEventListener?.("statechange", () => {
        if (ctx.state === "closed") rec.closed = true;
        if (ctx.state === "suspended") rec.suspendedCount++;
      });
      window.__audioProbe.ctxs.push(rec);
      return ctx;
    };
    NewAC.prototype = OrigAC.prototype;
    window.AudioContext = NewAC;
    if (window.webkitAudioContext) window.webkitAudioContext = NewAC;
    AC.__patched = true;
  }

  const proto = AC?.prototype;
  if (proto && !proto.__createBufferSourcePatched) {
    const origCreate = proto.createBufferSource;
    proto.createBufferSource = function () {
      const node = origCreate.call(this);
      const rec = {
        id: window.__audioProbe._nodeId++,
        node,
        startAt: null,
        stopped: false,
        created: performance.now(),
      };
      const origStart = node.start.bind(node);
      node.start = function (when) {
        rec.startAt = when;
        return origStart(when);
      };
      const origStop = node.stop.bind(node);
      node.stop = function (...a) {
        rec.stopped = true;
        return origStop.apply(node, a);
      };
      window.__audioProbe.nodes.push(rec);
      return node;
    };
    proto.__createBufferSourcePatched = true;
  }

  if (window.speechSynthesis && !window.speechSynthesis.__probed) {
    const origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    window.speechSynthesis.speak = function (u) {
      window.__audioProbe.speechSynthesisSpeaks++;
      return origSpeak(u);
    };
    window.speechSynthesis.__probed = true;
  }

  window.__audioProbe.snapshot = () => {
    const now = performance.now();
    const ctxs = window.__audioProbe.ctxs.map((c) => ({
      id: c.id,
      state: c.ctx.state,
      closed: c.closed,
      created: Math.round(c.created),
      ageMs: Math.round(now - c.created),
    }));
    const live = window.__audioProbe.nodes.filter((n) => !n.stopped);
    const active = live.filter((n) => n.startAt !== null && n.startAt <= performance.now() / 1000);
    const future = live.filter((n) => n.startAt !== null && n.startAt > performance.now() / 1000);
    const unscheduled = live.filter((n) => n.startAt === null);
    const scheduledCount = window.__audioProbe.nodes.filter((n) => n.startAt !== null).length;
    return {
      ctxCount: ctxs.length,
      ctxs,
      createdNodes: window.__audioProbe.nodes.length,
      scheduledNodes: scheduledCount,
      activeNodes: active.length,
      futureNodes: future.length,
      futureHorizonMs: future.length
        ? Math.round((Math.max(...future.map((n) => n.startAt)) - performance.now() / 1000) * 1000)
        : 0,
      unscheduledNodes: unscheduled.length,
      speechSynthesisSpeaks: window.__audioProbe.speechSynthesisSpeaks,
      nowMs: Math.round(now),
    };
  };
})();
