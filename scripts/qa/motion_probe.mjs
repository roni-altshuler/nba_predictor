// Browser instrumentation only: no frame sampling loop is created by this probe.
export function installMotionProbe() {
  const probe = window.__motionProbe = { requested: 0, executed: 0, cancelled: 0, draws: 0, pending: new Set() }
  const request = window.requestAnimationFrame.bind(window)
  const cancel = window.cancelAnimationFrame.bind(window)
  window.requestAnimationFrame = callback => {
    probe.requested++
    const id = request(time => { probe.pending.delete(id); probe.executed++; callback(time) })
    probe.pending.add(id)
    return id
  }
  window.cancelAnimationFrame = id => { probe.cancelled++; probe.pending.delete(id); cancel(id) }
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    probe.draws++
    return clear.apply(this, args)
  }
}

export function motionState() {
  const probe = window.__motionProbe
  return {
    requested: probe.requested, executed: probe.executed, pending: probe.pending.size, draws: probe.draws,
    canvases: document.querySelectorAll('canvas').length,
    ambientNodes: document.querySelectorAll('.ambient-court,.ambient-glow,.ambient-canvas,[data-ambient-option]').length,
    ambientAttribute: document.documentElement.getAttribute('data-ambient'),
    background: getComputedStyle(document.body).backgroundColor,
    backgroundImage: getComputedStyle(document.body).backgroundImage,
    animations: document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
      name: animation.animationName ?? 'Web Animation',
      iterations: String(animation.effect.getTiming().iterations),
      target: animation.effect.target?.className?.baseVal ?? animation.effect.target?.className ?? null,
    })),
    svgLoops: document.querySelectorAll('svg animate,svg animateTransform,svg animateMotion').length,
    storage: localStorage.getItem('hardwood-ambient'),
  }
}
