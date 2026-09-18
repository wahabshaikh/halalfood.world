import { initDataFast } from "datafast";

const DATAFAST_WEBSITE_ID = "dfid_ZgOOfrW4AAKMqIY9gqUEs";
const DATAFAST_DOMAIN = "halalfood.world";

let analytics: ReturnType<typeof initDataFast> | null = null;

export function getAnalytics() {
  if (!analytics) {
    analytics = initDataFast({
      websiteId: DATAFAST_WEBSITE_ID,
      domain: DATAFAST_DOMAIN,
      autoCapturePageviews: true,
    });
  }
  return analytics;
}
