/** One read projection for document customer names. The saved header remains
 * the historical fallback; only schema-verified customer linking enables it. */
export function orderCustomerNameSql(customerProfilesEnabled=false):string{
 if(!customerProfilesEnabled)return 'o.receiving_unit';
 return "COALESCE((SELECT current_customer.display_name FROM customer_order_links current_link "+
  'JOIN customers current_customer ON current_customer.id=current_link.customer_id '+
  'WHERE current_link.order_id=o.id AND current_customer.archived_at IS NULL '+
  "AND JSON_EXTRACT(current_customer.profile_json,'$.deletedAt') IS NULL LIMIT 1),o.receiving_unit)";
}
