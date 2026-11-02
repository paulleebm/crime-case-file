import trophy from '../assets/illustrations/trophy.webp';
import { OfficeSketch } from '../ui/MapView';
/** 자료에 사용하는 원화. 지명과 증거 표시는 지도 위에 별도로 얹는다. */
export function Sketch({ name, width = 320, stamp }: { name: string; width?: number; stamp?: string }) {
  void stamp;
  if (name === 'office-forensic') return <OfficeSketch width={width} />;
  return <img src={trophy} alt="회수 트로피 TR-01 감정 기록 그림" width={width} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />;
}
