/** the administrator the provisioner acts as, for the life of the provisioning process alone */
export type AdminCredentials = {
  readonly email: string;
  readonly password: string;
  readonly username: string;
};
