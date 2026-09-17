/* global liveViewCapture */
(function () {
  'use strict';

  /** @type {RTCPeerConnection | null} */
  let pc = null;
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {MediaStreamTrack | null} */
  let videoTrack = null;
  let privacyBlocked = false;
  let statsTimer = null;
  let maxBitrateBps = 600000;

  function emitState(state, reason) {
    try {
      liveViewCapture.pcState(state, reason);
    } catch (_) { /* ignore */ }
  }

  function emitSignal(signal) {
    try {
      liveViewCapture.signalOut(signal);
    } catch (_) { /* ignore */ }
  }

  async function applySenderBitrate() {
    if (!pc) return;
    const senders = pc.getSenders().filter((s) => s.track && s.track.kind === 'video');
    for (const sender of senders) {
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = maxBitrateBps;
        await sender.setParameters(params);
      } catch (_) { /* ignore */ }
    }
  }

  async function preferCodecs() {
    if (!pc || typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return;
    try {
      const caps = RTCRtpSender.getCapabilities('video');
      if (!caps || !caps.codecs) return;
      const prefer = [];
      const rest = [];
      for (const c of caps.codecs) {
        const mime = (c.mimeType || '').toLowerCase();
        if (mime.includes('vp8') || mime.includes('h264')) prefer.push(c);
        else rest.push(c);
      }
      const transceiver = pc.getTransceivers().find((t) => t.sender && t.sender.track && t.sender.track.kind === 'video');
      if (transceiver && typeof transceiver.setCodecPreferences === 'function') {
        transceiver.setCodecPreferences(prefer.concat(rest));
      }
    } catch (_) { /* ignore */ }
  }

  function startStatsWatch() {
    stopStatsWatch();
    statsTimer = setInterval(async () => {
      if (!pc) return;
      try {
        const stats = await pc.getStats();
        let rtt = 0;
        let lost = 0;
        let sent = 0;
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = r.currentRoundTripTime * 1000;
          }
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            lost += r.packetsLost || 0;
            sent += r.packetsSent || 0;
          }
        });
        const loss = sent > 0 ? lost / (sent + lost) : 0;
        if (rtt > 1500 || loss > 0.05) {
          emitState('degraded', loss > 0.05 ? 'packet_loss' : 'high_rtt');
        }
      } catch (_) { /* ignore */ }
    }, 2000);
  }

  function stopStatsWatch() {
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
  }

  async function getDesktopStream(width, fps) {
    const source = await liveViewCapture.getSource();
    const constraints = {
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: width || 1280,
          maxHeight: Math.round(((width || 1280) * 9) / 16) || 720,
          maxFrameRate: fps || 3,
        },
      },
    };
    // Electron typed getUserMedia via legacy constraints.
    const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    return mediaStream;
  }

  async function start(data) {
    await stop();
    maxBitrateBps = data.maxBitrateBps || 600000;
    pc = new RTCPeerConnection({
      iceServers: Array.isArray(data.iceServers) ? data.iceServers : [],
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        emitSignal({ type: 'ice', candidate: ev.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc && pc.connectionState;
      if (st === 'connected') emitState('connected');
      else if (st === 'failed') emitState('failed', 'ice_failed');
      else if (st === 'disconnected') emitState('degraded', 'disconnected');
    };

    pc.oniceconnectionstatechange = () => {
      const st = pc && pc.iceConnectionState;
      if (st === 'failed') emitState('failed', 'ice_failed');
      if (st === 'connected' || st === 'completed') {
        console.log('[live_view] ice_connected');
      }
    };

    stream = await getDesktopStream(data.width, data.fps);
    videoTrack = stream.getVideoTracks()[0] || null;
    if (videoTrack) {
      try {
        videoTrack.contentHint = 'detail';
      } catch (_) { /* ignore */ }
      pc.addTrack(videoTrack, stream);
    }

    await preferCodecs();
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    emitSignal({ type: 'offer', sdp: offer.sdp });
    await applySenderBitrate();
    startStatsWatch();
    applyPrivacyMute();
  }

  function applyPrivacyMute() {
    if (!videoTrack) return;
    videoTrack.enabled = !privacyBlocked;
  }

  async function handleSignal(signal) {
    if (!pc || !signal) return;
    try {
      if (signal.type === 'answer' && signal.sdp) {
        await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
        console.log('[live_view] webrtc_answer_received');
      } else if (signal.type === 'ice' && signal.candidate) {
        await pc.addIceCandidate(signal.candidate);
      } else if (signal.type === 'renegotiate') {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSignal({ type: 'offer', sdp: offer.sdp });
      }
    } catch (err) {
      emitState('failed', (err && err.message) || 'signal_error');
    }
  }

  async function applyConstraints(data) {
    maxBitrateBps = data.maxBitrateBps || maxBitrateBps;
    await applySenderBitrate();
    if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
      try {
        await videoTrack.applyConstraints({
          width: { ideal: data.width },
          frameRate: { ideal: data.fps, max: data.fps },
        });
      } catch (_) { /* ignore */ }
    }
  }

  async function stop() {
    stopStatsWatch();
    if (videoTrack) {
      try { videoTrack.stop(); } catch (_) { /* ignore */ }
      videoTrack = null;
    }
    if (stream) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* ignore */ }
      stream = null;
    }
    if (pc) {
      try { pc.close(); } catch (_) { /* ignore */ }
      pc = null;
    }
  }

  liveViewCapture.onStart((data) => {
    start(data).catch((err) => emitState('failed', (err && err.message) || 'start_failed'));
  });
  liveViewCapture.onStop(() => { stop(); });
  liveViewCapture.onSignalIn((signal) => { handleSignal(signal); });
  liveViewCapture.onPrivacy((data) => {
    privacyBlocked = !!(data && data.blocked);
    applyPrivacyMute();
  });
  liveViewCapture.onConstraints((data) => { applyConstraints(data); });
  liveViewCapture.rendererReady();
})();
