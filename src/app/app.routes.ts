import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'books', pathMatch: 'full' },
  { path: 'books', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'books/:bookId', loadComponent: () => import('./features/editor/editor-page.component').then(m => m.EditorPageComponent) },
  { path: 'books/:bookId/import', loadComponent: () => import('./features/import/import-page.component').then(m => m.ImportPageComponent) },
  { path: '**', redirectTo: 'books' }
];
