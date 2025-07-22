import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { formatPartnerName } from '../utils/textUtils';

const PartnerCard = ({ partner, onPartnerClick, onPartnerRightClick }) => {
  const formatRevenue = (revenue) => {
    if (revenue >= 1000000) {
      return `$${(revenue / 1000000).toFixed(1)}M`;
    } else if (revenue >= 1000) {
      return `$${(revenue / 1000).toFixed(0)}K`;
    }
    return `$${revenue.toFixed(0)}`;
  };

  const getCapacityVariant = (capacity) => {
    return capacity > 80 ? 'destructive' : 'default';
  };

  return (
    <Card 
      className={`cursor-pointer hover:shadow-md transition-shadow ${
        partner.isDeparting ? 'border-red-500' : ''
      }`}
      onClick={() => onPartnerClick(partner)}
      onContextMenu={(e) => onPartnerRightClick?.(partner, e)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{formatPartnerName(partner.name)}</h3>
          {partner.isDeparting && (
            <Badge variant="destructive">Departing</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Revenue:</span>
            <span className="font-medium">{formatRevenue(partner.totalRevenue)}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Clients:</span>
            <span className="font-medium">{partner.clientCount}</span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Avg Strategic Value:</span>
            <span className="font-medium">{partner.avgStrategicValue.toFixed(1)}</span>
          </div>
          
          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Capacity:</span>
              <span className="text-sm font-medium">{Math.round(partner.capacityUsed)}%</span>
            </div>
            <Progress 
              value={partner.capacityUsed} 
              className="h-2"
              variant={getCapacityVariant(partner.capacityUsed)}
            />
          </div>
          
          {partner.practiceAreas.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {partner.practiceAreas.slice(0, 3).map((area, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {area}
                </Badge>
              ))}
              {partner.practiceAreas.length > 3 && (
                <Badge variant="secondary" className="text-xs">
                  +{partner.practiceAreas.length - 3}
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default PartnerCard;