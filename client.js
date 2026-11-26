window.__ModuleLoader__.load({
  id: 'dsh-go-quota',
  factory(require) {
    const React = require('react');
    let createPortal = null;
    try {
      createPortal = require('react-dom').createPortal ?? null;
    } catch {
      createPortal = null;
    }
    const h = React.createElement;

    const ROUTE = '/go-quota/usage';
    const POLL_MS = 60_000;
    const RADIUS = 5.5;
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
    const WINDOWS = [
      ['5h', '5 小时窗口', 'rolling', 'system'],
      ['7d', '本周', 'weekly', 'tools'],
      ['30d', '本月', 'monthly', 'messages'],
    ];

    // Mirrors the conversation context meter: same tokens, same paddings, so the
    // pill and its popover sit in the composer dock as first-party chrome.
    const CSS = `
.dsh-gq{display:inline-flex;align-items:center;gap:6px;padding:1px 8px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;cursor:pointer;-webkit-user-select:none;user-select:none}
.dsh-gq:hover,.dsh-gq[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dsh-gq[data-state="error"],.dsh-gq[data-state="loading"]{opacity:.55;cursor:default}
.dsh-gq svg{display:block;flex:none}
.dsh-gq-track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}
.dsh-gq-fill{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-width:2px;stroke-linecap:round}
.dsh-gq-dot{opacity:.4;padding:0 1px}
.dsh-gq-panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu);width:min(264px,100vw - 24px);backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);padding:12px;font-family:inherit;font-size:12px;line-height:20px;position:fixed;overflow:hidden auto;text-align:left;white-space:normal}
.dsh-gq-header{display:flex;align-items:center;gap:6px}
.dsh-gq-headline{color:var(--dsw-alias-label-tertiary)}
.dsh-gq-percent{color:var(--dsw-alias-label-primary);font-weight:500}
.dsh-gq-figures{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}
.dsh-gq-bar{corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;height:4px;margin:10px 0 12px;display:flex;overflow:hidden}
.dsh-gq-seg{background:var(--dsw-alias-label-tertiary);border-radius:1px;min-width:2px;height:100%}
.dsh-gq-rows{margin:6px 0 0;padding:0;display:block}
.dsh-gq-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:2px 0}
.dsh-gq-row dt{color:var(--dsw-alias-label-secondary);display:flex;align-items:center;margin:0}
.dsh-gq-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}
.dsh-gq-swatch{background:var(--dsw-alias-label-tertiary);border-radius:2px;width:8px;height:8px;margin-right:6px;display:inline-block;flex:none}
.dsh-gq-swatch[data-tint="system"]{background:var(--dsw-alias-chart-system)}
.dsh-gq-swatch[data-tint="tools"]{background:var(--dsw-alias-chart-tools)}
.dsh-gq-swatch[data-tint="messages"]{background:var(--dsw-alias-chart-messages)}
.dsh-gq-foot{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
`;

    function clockText(iso) {
      if (typeof iso !== 'string') return '';
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return '';
      const d = new Date(ms);
      const two = (n) => String(n).padStart(2, '0');
      return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
    }

    function percentOf(window) {
      return window !== undefined && window !== null && typeof window.percent === 'number' ? window.percent : undefined;
    }

    function Ring({ percent }) {
      const value = typeof percent === 'number' ? Math.max(0, Math.min(100, percent)) : 0;
      return h(
        'svg',
        { viewBox: '0 0 14 14', width: 14, height: 14, 'aria-hidden': true },
        h('circle', { className: 'dsh-gq-track', cx: 7, cy: 7, r: RADIUS }),
        h('circle', {
          className: 'dsh-gq-fill',
          cx: 7,
          cy: 7,
          r: RADIUS,
          strokeDasharray: `${(CIRCUMFERENCE * value) / 100} ${CIRCUMFERENCE}`,
          transform: 'rotate(-90 7 7)',
        }),
      );
    }

    function useUsage() {
      const [snap, setSnap] = React.useState({ phase: 'loading' });
      React.useEffect(() => {
        let cancelled = false;
        const load = async () => {
          try {
            const response = await fetch(ROUTE, { signal: AbortSignal.timeout(8_000) });
            const body = await response.json();
            if (cancelled) return;
            if (body !== null && typeof body === 'object' && body.ok === true && body.usage !== undefined) {
              setSnap({ phase: 'ok', usage: body.usage, fetchedAt: body.fetchedAt });
            } else {
              setSnap({ phase: 'error', message: String(body?.message ?? `HTTP ${response.status}`) });
            }
          } catch (error) {
            if (!cancelled) setSnap({ phase: 'error', message: String(error?.message ?? error) });
          }
        };
        void load();
        const timer = setInterval(() => void load(), POLL_MS);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }, []);
      return snap;
    }

    function GoQuotaPanel({ snap, anchor, onClose }) {
      const panelRef = React.useRef(null);
      const [pos, setPos] = React.useState(null);

      React.useEffect(() => {
        const place = () => {
          const rect = anchor.current?.getBoundingClientRect();
          if (rect === undefined) return;
          setPos({
            right: Math.max(8, window.innerWidth - rect.right),
            bottom: Math.max(8, window.innerHeight - rect.top + 8),
          });
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
      }, [anchor]);

      React.useEffect(() => {
        const onPointerDown = (event) => {
          const target = event.target;
          if (panelRef.current?.contains(target) === true) return;
          if (anchor.current?.contains(target) === true) return;
          onClose();
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [anchor, onClose]);

      const windows = WINDOWS.map(([short, label, key, tint]) => {
        const window = snap.usage?.[key];
        return { short, label, tint, percent: percentOf(window), reset: clockText(window?.resetsAt) };
      });
      const known = windows.filter((row) => row.percent !== undefined);
      const tightest = [...known].sort((a, b) => b.percent - a.percent)[0];
      const tightestPercent = tightest === undefined ? 0 : tightest.percent;

      const panel = h(
        'div',
        {
          ref: panelRef,
          className: 'dsh-gq-panel',
          role: 'dialog',
          'aria-label': 'OpenCode Go 用量',
          style: pos === null ? { visibility: 'hidden' } : { right: pos.right, bottom: pos.bottom },
        },
        h(
          'div',
          { className: 'dsh-gq-header' },
          h('span', { className: 'dsh-gq-headline' }, 'opencode Go 已用'),
          h('span', { className: 'dsh-gq-percent' }, `${tightestPercent}%`),
          h(
            'span',
            { className: 'dsh-gq-figures' },
            tightest === undefined ? '—' : `${tightest.short}${tightest.reset === '' ? '' : ` · ${tightest.reset}`}`,
          ),
        ),
        h('div', { className: 'dsh-gq-bar' }, h('div', { className: 'dsh-gq-seg', style: { width: `${tightestPercent}%` } })),
        h(
          'dl',
          { className: 'dsh-gq-rows' },
          ...windows.map((row) =>
            h(
              'div',
              { className: 'dsh-gq-row', key: row.short },
              h(
                'dt',
                null,
                h('span', { className: 'dsh-gq-swatch', 'data-tint': row.tint, 'aria-hidden': true }),
                row.label,
              ),
              h(
                'dd',
                null,
                row.percent === undefined ? '—' : `${row.percent}%${row.reset === '' ? '' : ` · ${row.reset}`}`,
              ),
            ),
          ),
        ),
        h('div', { className: 'dsh-gq-foot' }, clockText(snap.fetchedAt) === '' ? '' : `更新于 ${clockText(snap.fetchedAt)}`),
      );

      return createPortal === null ? panel : createPortal(panel, document.body);
    }

    function GoQuotaPill() {
      const snap = useUsage();
      const rootRef = React.useRef(null);
      const [open, setOpen] = React.useState(false);
      const close = React.useCallback(() => setOpen(false), []);

      React.useEffect(() => {
        if (snap.phase !== 'ok' && open) setOpen(false);
      }, [snap.phase, open]);

      if (snap.phase === 'loading') {
        return h('span', { className: 'dsh-gq', 'data-state': 'loading', title: '读取 OpenCode Go 用量…' }, 'Go · …');
      }
      if (snap.phase === 'error') {
        return h('span', { className: 'dsh-gq', 'data-state': 'error', title: snap.message }, 'Go · 不可用');
      }

      const rows = WINDOWS.map(([short, , key]) => ({ short, percent: percentOf(snap.usage?.[key]) }));
      const known = rows.filter((row) => row.percent !== undefined);
      const tightest = [...known].sort((a, b) => b.percent - a.percent)[0];

      return h(
        'span',
        { ref: rootRef, style: { display: 'inline-flex', flex: 'none' } },
        h(
          'button',
          {
            type: 'button',
            className: 'dsh-gq',
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            onClick: () => setOpen((value) => !value),
          },
          h(Ring, { percent: tightest === undefined ? 0 : tightest.percent }),
          h('span', null, 'Go'),
          ...rows.flatMap(({ short, percent }, index) => {
            const piece = h('span', { key: short }, `${short} ${percent === undefined ? '—' : `${percent}%`}`);
            return index === 0 ? [piece] : [h('span', { key: `${short}-dot`, className: 'dsh-gq-dot' }, '·'), piece];
          }),
        ),
        open ? h(GoQuotaPanel, { snap, anchor: rootRef, onClose: close }) : null,
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = 'dsh-go-quota';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'go-quota: styles');

        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            { name: 'conversation.composer.dock', id: 'go-quota', order: 2 },
            GoQuotaPill,
          ),
        );
      },
    };
  },
});
