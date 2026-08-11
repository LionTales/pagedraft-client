import { Routes } from '@angular/router';
import { editorCanDeactivate } from './features/editor/editor-can-deactivate.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'books', pathMatch: 'full' },
  { path: 'books', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  {
    path: 'books/:bookId',
    loadComponent: () => import('./features/editor/editor-page.component').then(m => m.EditorPageComponent),
    canDeactivate: [editorCanDeactivate]
  },
  { path: 'books/:bookId/import', loadComponent: () => import('./features/import/import-page.component').then(m => m.ImportPageComponent) },
  // Wave 3 / w4: export is a ROUTE, a sibling of import, so the spine's Export stage has a real destination
  // and the served guides can name a URL. A dialog would have had neither.
  { path: 'books/:bookId/export', loadComponent: () => import('./features/export/export-page.component').then(m => m.ExportPageComponent) },
  { path: '**', redirectTo: 'books' }
];
