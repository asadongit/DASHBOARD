#!/usr/bin/env bash
# ==============================================================================
# Script:  vapt_backup.sh
# Purpose: Pre-remediation dependency snapshotter & backup creator
# Usage:   sudo ./vapt_backup.sh <package_name> [optional_backup_base_dir]
# Stdout:  Prints strictly 'VAPT_SNAPSHOT_DIR=<path>' on successful backup
# Stderr:  Logs, warnings, and error messages
# ==============================================================================

set -o errexit
set -o nounset
set -o pipefail

# 1. Root & Privilege Checks
if [ "${EUID}" -ne 0 ]; then
    echo "[-] Error: This script must be executed with root/sudo privileges." >&2
    exit 1
fi

TARGET_PKG="${1:-}"
if [ -z "${TARGET_PKG}" ]; then
    echo "[-] Usage: sudo $0 <package_name> [backup_base_dir]" >&2
    exit 1
fi

# 2. Target Package Existence & State Check
if ! dpkg -s "${TARGET_PKG}" >/dev/null 2>&1; then
    echo "[-] Error: Target package '${TARGET_PKG}' is not installed on this system." >&2
    exit 1
fi

# 3. Path Resolution (Handle SUDO_USER properly)
if [ -n "${SUDO_USER:-}" ]; then
    USER_HOME=$(getent passwd "${SUDO_USER}" | cut -d: -f6)
else
    USER_HOME="${HOME}"
fi

DEFAULT_BACKUP_DIR="${USER_HOME}/update-backups"
BACKUP_BASE_DIR="${2:-${DEFAULT_BACKUP_DIR}}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
PKG_DIR="${BACKUP_BASE_DIR}/packagebackup/${TARGET_PKG}_${TIMESTAMP}"
TEMP_LOG=$(mktemp /tmp/vapt_backup_init.XXXXXX)

# Logging helpers: All progress goes to stderr and file
log() {
    local msg="[$(date +'%Y-%m-%d %H:%M:%S')] $1"
    echo "$msg" >&2
    if [ -d "${PKG_DIR}" ]; then
        echo "$msg" >> "${PKG_DIR}/backup.log"
    else
        echo "$msg" >> "${TEMP_LOG}"
    fi
}

warn() {
    local msg="[WARNING] $1"
    echo -e "\033[1;33m${msg}\033[0m" >&2
    if [ -d "${PKG_DIR}" ]; then
        echo "$msg" >> "${PKG_DIR}/backup.log"
    else
        echo "$msg" >> "${TEMP_LOG}"
    fi
}

cleanup_temp() {
    rm -f "${TEMP_LOG}"
}
trap cleanup_temp EXIT

log "[*] Evaluating upgrade dependencies for target: ${TARGET_PKG}"

# 4. Simulation via APT Dry-Run (Parsing Inst Lines)
# Avoid SIGPIPE under pipefail: run simulation without early-terminating pipes
SIMULATION=$(apt-get install --dry-run --only-upgrade "${TARGET_PKG}" 2>&1) || true

# Parse all packages marked for upgrade or new installation
INST_LINES=$(echo "${SIMULATION}" | awk '/^Inst / {print}')

if [ -z "${INST_LINES}" ]; then
    log "[!] Package '${TARGET_PKG}' is already at the latest version or not upgradable."
    exit 0
fi

# 5. Commit directory creation only now that an upgrade is confirmed
mkdir -p "${PKG_DIR}"
cat "${TEMP_LOG}" >> "${PKG_DIR}/backup.log"
rm -f "${TEMP_LOG}"
LOG_FILE="${PKG_DIR}/backup.log"

# Separate upgrades from newly introduced packages
# Inst lines with an existing version in brackets: Inst pkg [old_version] (new_version ...)
UPGRADE_PACKAGES=$(echo "${INST_LINES}" | awk '$0 ~ /^Inst [^ ]+ \[/ {print $2}' | tr '\n' ' ')

# Inst lines without an old version: Inst pkg (new_version ...)
NEW_PACKAGES=$(echo "${INST_LINES}" | awk '$0 ~ /^Inst [^ ]+ \(/ {print $2}' | tr '\n' ' ')

if [ -n "${NEW_PACKAGES// /}" ]; then
    warn "The following packages are NEW dependencies pulled by this upgrade: ${NEW_PACKAGES}"
    warn "Note: Newly added dependencies will not be present in the downgrade manifest and must be manually purged if rolling back."
    echo "${NEW_PACKAGES}" | tr ' ' '\n' | grep -v '^$' > "${PKG_DIR}/new_packages.txt" || true
fi

# Ensure TARGET_PKG is in the backup list if it was scheduled for an upgrade
if echo "${UPGRADE_PACKAGES}" | grep -qw "${TARGET_PKG}"; then
    AFFECTED_UPGRADES="${UPGRADE_PACKAGES}"
else
    AFFECTED_UPGRADES="${TARGET_PKG} ${UPGRADE_PACKAGES}"
fi

log "[+] Packages scheduled for version replacement: ${AFFECTED_UPGRADES}"

# 6. Generate Manifest of Exact Installed Versions
MANIFEST_FILE="${PKG_DIR}/manifest.txt"
> "${MANIFEST_FILE}"

for pkg in ${AFFECTED_UPGRADES}; do
    CURR_VER=$(dpkg-query -W -f='${Version}' "${pkg}" 2>/dev/null || true)
    if [ -n "${CURR_VER}" ]; then
        echo "${pkg}=${CURR_VER}" >> "${MANIFEST_FILE}"
    fi
done

# Check if dpkg-repack is installed WITHOUT running apt-get update mid-process
ensure_dpkg_repack() {
    if ! command -v dpkg-repack >/dev/null 2>&1; then
        log "[*] 'dpkg-repack' not found. Installing from existing package indices..."
        if ! apt-get install -y -qq --no-install-recommends dpkg-repack >> "${LOG_FILE}" 2>&1; then
            warn "Could not install 'dpkg-repack'. Tier C repacking will be unavailable."
            return 1
        fi
    fi
    return 0
}

# 7. Package Acquisition Waterfall (Tier A -> Tier B -> Tier C)
PKG_ARCH=$(dpkg --print-architecture)

while IFS='=' read -r pkg_name pkg_ver; do
    [ -z "${pkg_name}" ] && continue
    log "[*] Securing .deb for ${pkg_name} (${pkg_ver})..."
    ACQUIRED=false

    # Tier A: Local APT Cache with exact epoch & architecture matching
    # Apt encodes ':' in epoch as '%3a'
    CLEAN_VER=$(echo "${pkg_ver}" | sed 's/^[0-9]*://')
    ENCODED_VER=$(echo "${pkg_ver}" | sed 's/:/%3a/g')

    LOCAL_CACHE=$(find /var/cache/apt/archives/ -maxdepth 1 -type f \
        \( -name "${pkg_name}_${CLEAN_VER}_${PKG_ARCH}.deb" -o \
           -name "${pkg_name}_${ENCODED_VER}_${PKG_ARCH}.deb" -o \
           -name "${pkg_name}_${pkg_ver}_${PKG_ARCH}.deb" -o \
           -name "${pkg_name}_${CLEAN_VER}_all.deb" -o \
           -name "${pkg_name}_${ENCODED_VER}_all.deb" \) 2>/dev/null | head -n 1 || true)

    if [ -n "${LOCAL_CACHE}" ] && [ -f "${LOCAL_CACHE}" ]; then
        cp "${LOCAL_CACHE}" "${PKG_DIR}/"
        log "  -> [Tier A: Cache] Found in /var/cache/apt/archives/: $(basename "${LOCAL_CACHE}")"
        ACQUIRED=true
    fi

    # Tier B: Remote Repositories via apt-get download
    if [ "${ACQUIRED}" = false ]; then
        log "  -> Tier A missed. Querying upstream mirrors via 'apt-get download'..."
        if (cd "${PKG_DIR}" && apt-get download "${pkg_name}=${pkg_ver}" >> "${LOG_FILE}" 2>&1); then
            log "  -> [Tier B: Mirror] Downloaded authentic upstream deb: ${pkg_name}=${pkg_ver}"
            ACQUIRED=true
        fi
    fi

    # Tier C: Local System Repack
    if [ "${ACQUIRED}" = false ]; then
        log "  -> Tier B missed. Attempting Tier C (Local system reconstruction)..."
        if ensure_dpkg_repack; then
            if (cd "${PKG_DIR}" && dpkg-repack "${pkg_name}" >> "${LOG_FILE}" 2>&1); then
                warn "  -> [Tier C: Repack] Created repack of ${pkg_name}. Note: Repacked debs capture the current live filesystem state including any modified files."
                ACQUIRED=true
            else
                warn "Failed to execute dpkg-repack on ${pkg_name}."
            fi
        fi
    fi

    if [ "${ACQUIRED}" = false ]; then
        warn "Could not secure any local or upstream .deb archive for [${pkg_name}=${pkg_ver}]."
    fi
done < "${MANIFEST_FILE}"

# 8. Configuration Backup: Query Conffiles explicitly (avoids full directory recursion)
CONF_BACKUP="${PKG_DIR}/etc_configs.tar.gz"
log "[*] Discovering and archiving exact configuration files..."

# Query Conffiles defined across all affected packages
CONF_FILES=$(dpkg-query -W -f='${Conffiles}\n' ${AFFECTED_UPGRADES} 2>/dev/null | awk '{print $1}' | grep '^/' || true)

if [ -n "${CONF_FILES}" ]; then
    # Verify which files actually exist on the filesystem before archiving
    EXISTING_CONFS=""
    for conf in ${CONF_FILES}; do
        if [ -f "${conf}" ]; then
            EXISTING_CONFS="${EXISTING_CONFS}${conf}\n"
        fi
    done

    if [ -n "${EXISTING_CONFS}" ]; then
        if printf "%b" "${EXISTING_CONFS}" | tar -czf "${CONF_BACKUP}" -T - 2>>"${LOG_FILE}"; then
            log "[+] Successfully archived configurations to: ${CONF_BACKUP}"
        else
            warn "Failed to create complete configuration archive. Check ${LOG_FILE} for details."
        fi
    fi
fi

# 9. Verification Step: Compare Manifest vs Preserved Archives
log "[*] Verifying backup archive integrity..."
TOTAL_ENTRIES=0
VERIFIED_ENTRIES=0
MISSING_PACKAGES=""

while IFS='=' read -r pkg_name pkg_ver; do
    [ -z "${pkg_name}" ] && continue
    TOTAL_ENTRIES=$((TOTAL_ENTRIES + 1))
    
    # Check if a .deb covering this package exists in PKG_DIR
    MATCHING_DEB=$(find "${PKG_DIR}" -maxdepth 1 -type f -name "${pkg_name}_*.deb" | head -n 1 || true)
    if [ -n "${MATCHING_DEB}" ]; then
        VERIFIED_ENTRIES=$((VERIFIED_ENTRIES + 1))
    else
        MISSING_PACKAGES="${MISSING_PACKAGES} ${pkg_name}"
    fi
done < "${MANIFEST_FILE}"

log "[+] Backup summary: ${VERIFIED_ENTRIES}/${TOTAL_ENTRIES} packages verified in ${PKG_DIR}"
if [ -n "${MISSING_PACKAGES}" ]; then
    warn "The following packages lack local .deb rollback archives:${MISSING_PACKAGES}"
fi

# 10. Chown ONLY the specific generated snapshot directory
if [ -n "${SUDO_USER:-}" ]; then
    chown -R "${SUDO_USER}:" "${PKG_DIR}" 2>/dev/null || true
fi

# 11. Final Clean Stdout for Pipeline Capture
echo "VAPT_SNAPSHOT_DIR=${PKG_DIR}"