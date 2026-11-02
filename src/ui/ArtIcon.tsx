import home from '../assets/ui/icon-home.webp';
import hint from '../assets/ui/icon-hint.webp';
import radio from '../assets/ui/icon-radio.webp';
import team from '../assets/ui/icon-team.webp';
import tray from '../assets/ui/icon-tray.webp';
import close from '../assets/ui/icon-close.webp';

const ICONS = { home, hint, radio, team, tray, close };

export function ArtIcon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return <img className="art-icon" src={ICONS[name]} width={size} height={size} alt="" aria-hidden="true" />;
}
