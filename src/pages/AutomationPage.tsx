// @ts-ignore
import AutomationApp from './Automation/AutomationApp';
import './Automation/AutomationApp.css';

export function AutomationPage() {
  return (
    <div className="automation-container animate-fade-in" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <AutomationApp />
    </div>
  );
}
