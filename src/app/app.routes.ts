import { Routes } from '@angular/router';
import { proEntitlementGuard } from './core/guards/pro-entitlement.guard';
import { viewerBlockGuard } from './core/guards/viewer-block.guard';
import { AppShellComponent } from './shared/shell/app-shell.component';

export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    children: [
      { path: '', redirectTo: 'workflows', pathMatch: 'full' },
      {
        path: 'onboarding',
        loadComponent: () => import('./features/onboarding/onboarding-page.component').then((m) => m.OnboardingPageComponent),
      },
      {
        path: 'workflows',
        loadComponent: () => import('./features/workflows/workflows-page.component').then((m) => m.WorkflowsPageComponent),
      },
      {
        path: 'builder/:id',
        canActivate: [viewerBlockGuard],
        loadComponent: () => import('./features/builder/builder-page.component').then((m) => m.BuilderPageComponent),
      },
      {
        path: 'triggers',
        loadComponent: () => import('./features/triggers/triggers-page.component').then((m) => m.TriggersPageComponent),
      },
      {
        path: 'actions',
        loadComponent: () => import('./features/actions/actions-page.component').then((m) => m.ActionsPageComponent),
      },
      {
        path: 'logs',
        loadComponent: () => import('./features/logs/logs-page.component').then((m) => m.LogsPageComponent),
      },
      {
        path: 'variables',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/variables/variables-page.component').then((m) => m.VariablesPageComponent),
      },
      {
        path: 'analytics',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/analytics/analytics-page.component').then((m) => m.AnalyticsPageComponent),
      },
      {
        path: 'marketplace',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/marketplace/marketplace-page.component').then((m) => m.MarketplacePageComponent),
      },
      {
        path: 'ai-assistant',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/ai-assistant/ai-assistant-page.component').then((m) => m.AiAssistantPageComponent),
      },
      {
        path: 'team',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/team/team-page.component').then((m) => m.TeamPageComponent),
      },
      {
        path: 'api-access',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/api-access/api-access-page.component').then((m) => m.ApiAccessPageComponent),
      },
      {
        path: 'audit-logs',
        canActivate: [proEntitlementGuard],
        loadComponent: () => import('./features/audit-logs/audit-logs-page.component').then((m) => m.AuditLogsPageComponent),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings-page.component').then((m) => m.SettingsPageComponent),
      },
    ],
  },
];
