output "hetzner_server_id" {
  description = "Hetzner server id."
  value       = hcloud_server.prod.id
}

output "hetzner_server_name" {
  description = "Hetzner server name."
  value       = hcloud_server.prod.name
}

output "hetzner_primary_ipv4" {
  description = "Static production IPv4."
  value       = hcloud_primary_ip.prod_ipv4.ip_address
}

output "hetzner_dns_a_record_hint" {
  description = "Cloudflare A record to create when DNS is configured."
  value       = "A ${var.domain} ${hcloud_primary_ip.prod_ipv4.ip_address}"
}

output "hetzner_direct_origin_smoke" {
  description = "HTTP direct-origin smoke command before Cloudflare DNS/TLS is ready."
  value       = "curl --resolve ${var.domain}:80:${hcloud_primary_ip.prod_ipv4.ip_address} http://${var.domain}/healthz"
}

output "hetzner_https_origin_smoke" {
  description = "HTTPS direct-origin smoke command after Let’s Encrypt is configured and before Cloudflare proxy is enabled."
  value       = "curl --resolve ${var.domain}:443:${hcloud_primary_ip.prod_ipv4.ip_address} https://${var.domain}/healthz"
}

output "hetzner_ssh_command" {
  description = "Root SSH command for initial provisioning."
  value       = "ssh root@${hcloud_primary_ip.prod_ipv4.ip_address}"
}
