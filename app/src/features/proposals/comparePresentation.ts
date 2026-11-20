import type { CompareRow } from '../../components/market/compareModel';
import type { Proposal } from '../../lib/types';

type ProposalCompareInput = Pick<Proposal, 'id' | 'total' | 'valid_until'> & {
  proposal_schedule: readonly unknown[];
  providers?: Proposal['providers'];
};

export function proposalCompareRows(proposals: readonly ProposalCompareInput[]): CompareRow[] {
  return proposals.map((proposal) => ({
    id: proposal.id,
    who: proposal.providers?.profiles?.full_name ?? 'Verified provider',
    pricePaise: proposal.total,
    detail1: `${proposal.proposal_schedule.length} payments`,
    detail2: new Date(proposal.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }),
    rating: proposal.providers?.rating_avg ?? null,
  }));
}
