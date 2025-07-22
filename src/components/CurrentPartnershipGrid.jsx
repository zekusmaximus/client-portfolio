import PartnerCard from './PartnerCard';

const CurrentPartnershipGrid = ({ partners, onPartnerClick }) => {
  const calculateSummaryMetrics = () => {
    return partners.reduce((acc, partner) => {
      acc.totalRevenue += partner.totalRevenue;
      acc.totalClients += partner.clientCount;
      acc.avgCapacity += partner.capacityUsed;
      return acc;
    }, { 
      totalRevenue: 0, 
      totalClients: 0, 
      avgCapacity: 0 
    });
  };

  const formatRevenue = (revenue) => {
    if (revenue >= 1000000) {
      return `$${(revenue / 1000000).toFixed(1)}M`;
    } else if (revenue >= 1000) {
      return `$${(revenue / 1000).toFixed(0)}K`;
    }
    return `$${revenue.toFixed(0)}`;
  };

  const summaryMetrics = calculateSummaryMetrics();
  const avgCapacity = partners.length > 0 ? summaryMetrics.avgCapacity / partners.length : 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold mb-4">Current Partnership Structure</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600">Total Partners</div>
            <div className="text-2xl font-bold">{partners.length}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600">Total Revenue</div>
            <div className="text-2xl font-bold">{formatRevenue(summaryMetrics.totalRevenue)}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600">Total Clients</div>
            <div className="text-2xl font-bold">{summaryMetrics.totalClients}</div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="text-sm text-gray-600">Avg Capacity</div>
            <div className="text-2xl font-bold">{Math.round(avgCapacity)}%</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {partners.map((partner) => (
          <PartnerCard
            key={partner.id}
            partner={partner}
            onPartnerClick={onPartnerClick}
          />
        ))}
      </div>
    </div>
  );
};

export default CurrentPartnershipGrid;