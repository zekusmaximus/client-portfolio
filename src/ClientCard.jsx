import React from 'react';
import { Card, CardHeader, CardContent } from './components/ui/card';
import { Badge } from './components/ui/badge';
import usePortfolioStore from './portfolioStore';
import { Button } from './components/ui/button';
import {
  Pencil2Icon,
  PersonIcon,
  StarIcon,
  ValueIcon
} from '@radix-ui/react-icons';

/**
 * Mapping of client status → Tailwind color classes
 */
const statusColors = {
  'IF': 'bg-green-500',
  'P': 'bg-yellow-500',
  'D': 'bg-gray-400',
  'H': 'bg-red-500',
  'Prospect': 'bg-blue-500',
  'active': 'bg-green-500',
  'inactive': 'bg-gray-400',
  'prospect': 'bg-yellow-500',
};

/**
 * Get strategic value badge color based on value
 */
function getStrategicValueBadgeVariant(value) {
  if (value >= 7) return 'default'; // green
  if (value >= 4) return 'secondary'; // yellow/gray
  return 'destructive'; // red
}

/**
 * Format strategic value for display
 */
function formatStrategicValue(value) {
  return value ? value.toFixed(1) : '0.0';
}

/**
 * Format revenue for display
 */
function formatRevenue(revenues) {
  if (!revenues || !Array.isArray(revenues) || revenues.length === 0) {
    return '$0';
  }
  
  const totalRevenue = revenues.reduce((sum, rev) => sum + (parseFloat(rev.revenue_amount) || 0), 0);
  
  if (totalRevenue >= 1000000) {
    return `$${(totalRevenue / 1000000).toFixed(1)}M`;
  } else if (totalRevenue >= 1000) {
    return `$${(totalRevenue / 1000).toFixed(0)}K`;
  } else {
    return `$${totalRevenue.toFixed(0)}`;
  }
}

/**
 * Small coloured dot representing client status.
 */
function StatusDot({ status }) {
  const color = statusColors[status] || 'bg-gray-300';
  return <span className={`inline-block w-3 h-3 rounded-full ${color}`} />;
}

/**
 * ClientCard — enhanced presentational component for the main dashboard grid.
 *
 * Props:
 *   client: Client object from API with rich data
 */
export default function ClientCard({ client }) {
  const openClientModal = usePortfolioStore((s) => s.openClientModal);

  if (!client) return null;

  const { 
    name, 
    practice_area, 
    primary_lobbyist, 
    client_originator,
    lobbyist_team,
    status,
    strategic_value,
    revenues
  } = client;

  const strategicValueNum = parseFloat(strategic_value) || 0;
  const teamCount = lobbyist_team?.length || 0;
  const practiceAreaText = Array.isArray(practice_area) ? practice_area.join(', ') : practice_area;

  return (
    <Card className="flex flex-col justify-between hover:shadow-md transition-shadow duration-200">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-medium leading-none truncate">{name}</h4>
            <StatusDot status={status} />
          </div>
          <p className="text-sm text-muted-foreground truncate">{practiceAreaText}</p>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <Badge variant={getStrategicValueBadgeVariant(strategicValueNum)} className="text-xs">
            <StarIcon className="w-3 h-3 mr-1" />
            {formatStrategicValue(strategicValueNum)}
          </Badge>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Edit Client"
            onClick={() => openClientModal(client)}
            className="h-8 w-8"
          >
            <Pencil2Icon className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <div className="space-y-3">
          {/* Revenue Information */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <ValueIcon className="w-3 h-3" />
              <span>Revenue</span>
            </div>
            <span className="text-sm font-medium">{formatRevenue(revenues)}</span>
          </div>

          {/* Team Information */}
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Primary</p>
              <p className="font-medium truncate">{primary_lobbyist || 'Unassigned'}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Originator</p>
              <p className="font-medium truncate">{client_originator || 'Unknown'}</p>
            </div>
          </div>

          {/* Team Count */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <PersonIcon className="w-3 h-3" />
              <span>Team Size</span>
            </div>
            <Badge variant="outline" className="text-xs">
              {teamCount} {teamCount === 1 ? 'member' : 'members'}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}