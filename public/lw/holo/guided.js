// Guided exploration: the manifest's steps, one at a time.
// A step names a real component (checked by the server) or "whole".
export class Guided {
  constructor(app) { this.app = app; this.steps = []; this.index = -1; }
  get active() { return this.index >= 0; }
  setModel(manifest) { this.steps = manifest.guided || []; this.stop(); }

  start() { if (this.steps.length) this.go(0); }
  next() { if (this.active) this.index < this.steps.length - 1 ? this.go(this.index + 1) : this.stop(); }
  prev() { if (this.active && this.index > 0) this.go(this.index - 1); }

  go(i) {
    this.index = i;
    const step = this.steps[i];
    const app = this.app;
    if (step.component_id === 'whole') { app.select(null, { quiet: true }); app.sm.goHome(); }
    else { app.select(step.component_id, { quiet: true }); app.ix.focus(step.component_id); }
    app.ui.tour(step, i, this.steps.length);
    app.api('POST', 'api/narrate', { model_id: app.manifest.model_id, step: i }).catch(() => {});
    app.reportState();
  }

  stop() { this.index = -1; this.app.ui && this.app.ui.tour(null); }
}
