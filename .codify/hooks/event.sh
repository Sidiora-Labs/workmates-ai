#!/bin/sh
source_name=${1:-generic}
exec cg event ingest --source "$source_name"
