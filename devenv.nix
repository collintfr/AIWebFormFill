{ pkgs, ... }:

{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_22;
    npm.enable = true;
    # Install explicitly with npm ci --ignore-scripts; entering a shell is inert.
    npm.install.enable = false;
  };

  packages = [ pkgs.git pkgs.ripgrep pkgs.jq pkgs.zip pkgs.unzip ];

  # Keep package-manager artifacts in the ignored project state directory.
  env.npm_config_cache = "${builtins.toString ./.}/.devenv/npm-cache";

  scripts.project-test.exec = "npm test";
  scripts.project-audit.exec = "npm audit --ignore-scripts";

  tasks."project:test" = {
    exec = "npm test";
    before = [ "devenv:enterTest" ];
  };
}
