import { useLocalSearchParams } from "expo-router";
import { BodyDetail, type BodyId } from "../../details/body";
import { PriceDetail } from "../../details/price";
import { SeriesDetail, type SeriesId } from "../../details/series";
import { LoadDetail, NightsDetail } from "../../details/wallet";

const SERIES: SeriesId[] = ["dvol", "premium", "solindex", "fng", "corr"];
const BODY: BodyId[] = ["hrv", "hrvcv", "rhr", "sleep", "energy"];

export default function ChartPage() {
  const { id, sub, mint } = useLocalSearchParams<{ id: string; sub?: string; mint?: string }>();
  if (id === "sol") return <PriceDetail />;
  if (id === "coin" && mint) return <PriceDetail key={mint} mint={mint} />;
  if (id === "load") return <LoadDetail initialSub={sub} />;
  if (id === "nights") return <NightsDetail />;
  if (SERIES.includes(id as SeriesId)) return <SeriesDetail key={id} id={id as SeriesId} />;
  if (BODY.includes(id as BodyId)) return <BodyDetail key={id} id={id as BodyId} />;
  return null;
}
