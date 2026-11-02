import { useEffect } from 'react';
import { Sketch } from '../data/illustrations';
import { EvidencePhoto } from '../data/forensicPhotos';
import type { Block } from '../data/types';
import { evidenceById } from '../engine/lookup';
import { useGame } from '../engine/state';
import { Box } from '../sketch/components';
import { RichText } from './RichText';

const KIND_LABEL: Record<string, string> = {
  plan: '도면', report: '보고서', log: '기록 출력물', photo: '사진', recording: '녹화 기록', testimony: '참고인 진술', search: '수색 결과',
};

function BlockView({ b, i, src }: { b: Block; i: number; src: string }) {
  switch (b.type) {
    case 'p': return <p><RichText text={b.text} /></p>;
    case 'h': return <h4>{b.text}</h4>;
    case 'table':
      return (
        <table className="doc-table">
          {b.head && <thead><tr>{b.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>}
          <tbody>{b.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}><RichText text={c} /></td>)}</tr>)}</tbody>
        </table>
      );
    case 'log': return <Box className="logpaper" seed={`${src}log${i}`}>{b.lines.map((l, k) => <div key={k}><RichText text={l || ' '} /></div>)}</Box>;
    case 'sketch':
      return (
        <figure className="figure">
          <Box className="sheet" seed={`${src}fig${i}`} style={{ padding: 12, display: 'inline-block' }}><Sketch name={b.name} width={b.name === 'office-forensic' ? 600 : 420} /></Box>
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    case 'photo':
      return (
        <figure className="figure">
          <EvidencePhoto name={b.name} width={600} alt={b.caption} />
          {b.caption && <figcaption>{b.caption}</figcaption>}
        </figure>
      );
    case 'cuts':
      return (
        <div className="cuts">
          {b.cuts.map((c, k) => (
            <Box key={k} className="cut" seed={`${src}${c.time}${k}`}>
              <Sketch name={c.sketch} width={260} stamp={c.time} />
              <div className="tc">{c.time}</div>
              <p><RichText text={c.text} /></p>
            </Box>
          ))}
        </div>
      );
  }
}

export function DocView({ id }: { id: string }) {
  const { dispatch } = useGame();
  const ev = evidenceById.get(id);
  useEffect(() => { dispatch({ type: 'seen', id }); }, [id, dispatch]);
  if (!ev) return <div className="empty">자료를 찾을 수 없다.</div>;
  return (
    <>
      <div className="docview">
        <h3 className="doc-title">{ev.title}</h3>
        <div className="doc-meta">{ev.id} · {KIND_LABEL[ev.kind]}{ev.obtained ? ` · ${ev.obtained}` : ''}</div>
        {id !== 'BRIEF' && <div className="doc-meta tray-tip">밑줄 친 문장을 누르면 근거 트레이에 담긴다.</div>}
        {ev.body.map((b, i) => <BlockView key={i} b={b} i={i} src={ev.id} />)}
      </div>
    </>
  );
}
