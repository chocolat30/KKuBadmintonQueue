import { createBrowserRouter } from 'react-router';
import { Root } from './components/Root';
import { CourtsPage } from './components/CourtsPage';
import { QueuePage } from './components/QueuePage';
import { HistoryPage } from './components/HistoryPage';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    children: [
      { index: true, Component: CourtsPage },
      { path: 'court/:id', Component: QueuePage },
      { path: 'court/:id/history', Component: HistoryPage },
      { path: 'history', Component: HistoryPage },
    ],
  },
]);
