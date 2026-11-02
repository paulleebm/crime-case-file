import { useEffect } from 'react';
import { PERSONS, personOf } from '../data/case';
import { toneOf } from '../data/tone';
import type { PersonId } from '../data/types';
import { useGame } from '../engine/state';
import { InkStamp, Portrait } from '../sketch/components';
import { FormView } from './FormView';
import { Interrogation } from './Interrogation';

/** 용의자 화면: 왼쪽 진술서, 오른쪽 대화창 */
export function PersonView({ person }: { person: PersonId }) {
  const { state, dispatch } = useGame();
  const p = PERSONS[person];
  useEffect(() => {
    const t = setTimeout(() => {
      state.unseen.filter((id) => personOf(id) === person).forEach((id) => dispatch({ type: 'seen', id }));
    }, 4000);
    return () => clearTimeout(t);
  }, [person, state.unseen, dispatch]);

  return (
    <div className="person-view">
      <div className="person-head">
        <Portrait person={person} w={64} h={78} />
        <div>
          <div style={{ font: '700 20px var(--doc)' }}>{p.name} <span className="muted" style={{ font: '13px var(--ui)' }}>{p.role} · {p.age}세</span></div>
          <div className="muted" style={{ fontSize: 12.5 }} title="지금까지 인정한 범위에 따른 태도">{toneOf(person, new Set(state.owned)).demeanor}</div>
        </div>
        <InkStamp style={{ marginLeft: 'auto' }}>참고인</InkStamp>
      </div>
      <div className="person-split">
        <div className="person-form"><FormView person={person} /></div>
        <div className="person-chat"><Interrogation key={person} person={person} /></div>
      </div>
    </div>
  );
}
