import { useMemo, useRef, useState } from 'react';
import {
  DefaultMinimap,
  DefaultTrackChevron,
  GeneGlyph,
  exonTrack,
  interProTrack,
  pfamTrack,
  variantTrack,
} from '@populationgenomics/gene-glyph';
import type {
  GeneGlyphRef,
  GutterItem,
  Track,
  TrackOrGroup,
} from '@populationgenomics/gene-glyph';

// When the host collapses a track we want the chevron to stay reachable
// so the user can expand it back. The cleanest way: leave the track in
// the list but swap it for a zero-feature stub. The stub reserves one
// gutter-row height (so the chevron stays visible) and renders nothing
// inside the figure.
//
// `emptyData` matters: when the user re-expands, the real track is mounted
// and the viewer re-loads it asynchronously. Between the swap and the
// load resolving, the previous render is invoked with whatever data is
// already in the per-track map — so the stub must return a value that
// matches the real track's data shape, or the real track's render would
// crash dereferencing fields the stub didn't fill. The caller passes the
// matching empty shape (e.g., `{ domains: [] }` for Pfam).
function collapsedStub(id: string, label: string, emptyData: unknown): Track {
  return {
    id,
    coordSystem: 'cds',
    heightPolicy: 'auto',
    async load() {
      return emptyData;
    },
    height() {
      return { px: 22, didTruncate: false };
    },
    render() {
      return null;
    },
    toJSON() {
      return { id, label, collapsed: true };
    },
  };
}
import { TP53_PROTEIN, TP53_TRANSCRIPT, TP53_VARIANTS } from '../fixtures/tp53.js';

/**
 * Slice 20 — drop-in chrome demo.
 *
 * The track list is held as four independently-collapsible entries: the
 * always-on exon track, the variants track, the Pfam track, and the
 * InterPro group. The host keeps a `collapsedIds` Set;
 * `<DefaultTrackChevron>` renders the toggle UI in the gutter and fires
 * `onToggle`, and the host filters the corresponding entry out of the
 * `tracks` prop when collapsed.
 *
 * The footer renders `<DefaultMinimap>` against the same viewer ref. The
 * window rect can be dragged (pans the figure) and the edge handles
 * resized (zoom). Clicking outside the window jumps the viewer to that
 * location — animated via the public `fitTo` flow so reduced-motion
 * handling is the same as every other navigation.
 */
export function DefaultChromeScenario() {
  const ref = useRef<GeneGlyphRef | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const tracks = useMemo<TrackOrGroup[]>(() => {
    const out: TrackOrGroup[] = [exonTrack({})];
    out.push(
      collapsed.has('variants')
        ? collapsedStub('variants', 'Variants', { variants: [] })
        : variantTrack({ id: 'variants', source: TP53_VARIANTS }),
    );
    out.push(
      collapsed.has('pfam-track')
        ? collapsedStub('pfam-track', 'Pfam', { domains: [] })
        : pfamTrack({}),
    );
    if (collapsed.has('interpro')) {
      // The InterPro group can't host a non-group stub; swap the whole group
      // for a single zero-feature stub track. The chevron's data-vv-item-id
      // still resolves to 'interpro' so the test scoping continues to work.
      // No need for matching shape — the InterPro group's sub-track ids
      // (e.g., 'interpro-family') no longer appear in `flatTracks`, so the
      // viewer's GC drops their data entirely.
      out.push(collapsedStub('interpro', 'InterPro', null));
    } else {
      out.push(interProTrack({}));
    }
    return out;
  }, [collapsed]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Friendly labels for the chevron rows. Tracks don't carry a `label` on
  // the GutterItem (only groups do), so the host owns the display text for
  // anything not a group.
  const labels: Record<string, string> = {
    variants: 'Variants',
    'pfam-track': 'Pfam',
    interpro: 'InterPro',
  };
  const collapsibleTopLevel = new Set(Object.keys(labels));

  return (
    <section className="scenario" aria-labelledby="scenario-default-chrome">
      <h2 id="scenario-default-chrome">Default chrome — TP53</h2>
      <p className="scenario-blurb">
        <code>&lt;DefaultTrackChevron&gt;</code> handles the LeftGutter row
        toggle UI; <code>&lt;DefaultMinimap&gt;</code> lives in the Footer
        and drives pan/zoom by direct manipulation. Both are built using
        only the public ref API and the slot system.
      </p>
      <GeneGlyph
        ref={ref}
        transcript={TP53_TRANSCRIPT}
        protein={TP53_PROTEIN}
        tracks={tracks}
        trackHeightBudget={260}
      >
        <GeneGlyph.LeftGutter width={140}>
          {(item: GutterItem) => {
            if (collapsibleTopLevel.has(item.id)) {
              return (
                <DefaultTrackChevron
                  item={item}
                  collapsed={collapsed.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  label={labels[item.id]}
                />
              );
            }
            const label = item.label ?? item.id;
            return (
              <span className="vv-default-chevron-label" title={label}>
                {label}
              </span>
            );
          }}
        </GeneGlyph.LeftGutter>
        <GeneGlyph.Footer height={40}>
          <DefaultMinimap viewerRef={ref} width={520} height={28} />
        </GeneGlyph.Footer>
      </GeneGlyph>
    </section>
  );
}
