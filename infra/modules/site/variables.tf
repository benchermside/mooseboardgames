variable "env" {
  description = "Environment name, used as a suffix on resource names: dev or prod."
  type        = string
}

variable "zone_name" {
  description = "The Route 53 hosted zone."
  type        = string
  default     = "mooseboardgames.com"
}

variable "site_domain" {
  description = "Domain the HTML is served from, e.g. dev.mooseboardgames.com."
  type        = string
}

variable "api_domain" {
  description = "Domain the site API is served from, e.g. dev-api.mooseboardgames.com."
  type        = string
}

variable "site_bucket_name" {
  description = "S3 bucket holding the site's HTML."
  type        = string
}

variable "site_web_acl_id" {
  description = "WAF web ACL attached to the site distribution, or null for none."
  type        = string
  default     = null
}

variable "api_web_acl_id" {
  description = "WAF web ACL attached to the API distribution, or null for none."
  type        = string
  default     = null
}

# --- Names kept from resources first created in the console. ---
# Changing any of these makes Terraform replace (or, for origin IDs, edit) the
# resource, so dev passes the existing values. New environments use the defaults.

variable "site_origin_id" {
  type    = string
  default = "site-bucket"
}

variable "api_origin_id" {
  type    = string
  default = "site-api"
}

variable "oac_name" {
  type    = string
  default = null # null means "oac-<site_bucket_name>"
}

variable "api_role_name" {
  type    = string
  default = null # null means "mooseboardgames-siteAPI-<env>"
}

variable "api_policy_name" {
  type    = string
  default = null # null means "mooseboardgames-siteAPIPolicy-<env>"
}
