// @ts-ignore
import VaptApp from './Vapt/VaptApp';
import './Vapt/VaptApp.css';

export function VaptPage() {
  return (
    <div className="automation-container vapt-container animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <VaptApp />
    </div>
  );
}
