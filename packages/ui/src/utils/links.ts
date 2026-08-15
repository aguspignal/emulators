import { Linking } from "react-native";
import i18n from "../i18n";
import { showErrorAlert } from "./errors";

/** Opens a URL in the browser, alerting localized copy if nothing handles it.
    Module-level function, so global i18n.t — evaluated at press time. */
export function openExternalLink(url: string) {
  Linking.openURL(url).catch((e) =>
    showErrorAlert(i18n.t("license.openLinkFailed"), e, i18n.t("license.openLinkMessage")),
  );
}
