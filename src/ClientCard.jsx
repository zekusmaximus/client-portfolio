import React from 'react';
import { Card, CardHeader, CardContent } from './components/ui/card';
import usePortfolioStore from './portfolioStore';
import { Button } from './components/ui/button';
import { Pencil2Icon } from '@radix-ui/react-icons';

/**
 * Mapping of client status → Tailwind color classes
 */
const statusColors = {
  active: 'bg-green-500',
  inactive: 'bg-gray-400',
  prospect: 'bg-yellow-500',
};

/**
 * Small coloured dot representing client status.
 */
function StatusDot({ status }) {
  const color = statusColors[status] || 'bg-gray-300';
  return <span className={`inline-block w-3 h-3 rounded-full ${color}`} />;
}

/**
 * ClientCard — presentational component for the main dashboard grid.
 *
 * Props:
 *   client: Client object from API
 */
export default function ClientCard({ client }) {
  const openClientModal = usePortfolioStore((s) => s.openClientModal);

  if (!client) return null;

  const { name, practiceArea, primaryLobbyist, status } = client;

  return (
    <Card className="flex flex-col justify-between">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <h4 className="font-medium leading-none">{name}</h4>
          <p className="text-sm text-muted-foreground">{practiceArea}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Edit Client"
          onClick={() => openClientModal(client)}
        >
          <Pencil2Icon className="w-4 h-4" />
        </Button>
      </CardHeader>

      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <span>{primaryLobbyist}</span>
          <StatusDot status={status} />
        </div>
      </CardContent>
    </Card>
  );
}