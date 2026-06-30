locals {
  common_labels = merge(
    {
      application = "fishing-assistant"
      environment = "prod"
      managed_by  = "terraform"
    },
    var.labels
  )

  ipv4_ssh_cidrs = [for cidr in var.ssh_allowed_cidrs : cidr if can(regex("\\.", cidr))]
  ipv6_ssh_cidrs = [for cidr in var.ssh_allowed_cidrs : cidr if can(regex(":", cidr))]
}

resource "hcloud_ssh_key" "deploy" {
  name       = "fa-prod-deploy"
  public_key = var.deploy_ssh_public_key
  labels     = local.common_labels
}

resource "hcloud_primary_ip" "prod_ipv4" {
  name        = "fa-prod-primary-ipv4"
  location    = var.hetzner_location
  type        = "ipv4"
  auto_delete = false
  labels      = local.common_labels
}

resource "hcloud_firewall" "prod" {
  name   = "fa-prod-firewall"
  labels = local.common_labels

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = var.ssh_allowed_cidrs
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "80"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
  }

  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

resource "hcloud_server" "prod" {
  name         = var.server_name
  server_type  = var.hetzner_server_type
  image        = var.hetzner_image
  location     = var.hetzner_location
  ssh_keys     = [hcloud_ssh_key.deploy.id]
  firewall_ids = [hcloud_firewall.prod.id]
  backups      = var.enable_backups
  labels       = local.common_labels
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    deploy_ssh_public_key = var.deploy_ssh_public_key
  })

  public_net {
    ipv4_enabled = true
    ipv4         = hcloud_primary_ip.prod_ipv4.id
    ipv6_enabled = true
  }
}
