import { Outlet } from 'react-router';
import { AppProvider } from '../context/AppContext';

export function Root() {
  return (
    <AppProvider>
      <Outlet />
    </AppProvider>
  );
}
